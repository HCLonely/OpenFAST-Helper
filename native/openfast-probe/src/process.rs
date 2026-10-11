//! Read-only Windows process discovery. Each handle is closed by RAII.
use std::{ffi::c_void, mem::size_of, path::PathBuf};
use windows_sys::Win32::{
    Foundation::{CloseHandle, LocalFree, FILETIME, HANDLE, INVALID_HANDLE_VALUE},
    System::{
        Diagnostics::{Debug::ReadProcessMemory, ToolHelp::*},
        Threading::*,
    },
    UI::Shell::CommandLineToArgvW,
};

#[derive(Clone, Debug)]
pub struct Process {
    pub pid: u32,
    pub name: String,
    pub executable: String,
    pub started: f64,
    pub command: String,
    pub cwd: Option<PathBuf>,
    pub input: Option<PathBuf>,
    pub error: String,
}

struct OwnedHandle(HANDLE);
impl Drop for OwnedHandle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

#[link(name = "ntdll")]
extern "system" {
    fn NtQueryInformationProcess(
        process: HANDLE,
        class: u32,
        info: *mut c_void,
        size: u32,
        returned: *mut u32,
    ) -> i32;
}

pub fn split_command(command: &str) -> Vec<String> {
    let wide: Vec<u16> = command.encode_utf16().chain(Some(0)).collect();
    unsafe {
        let mut count = 0;
        let argv = CommandLineToArgvW(wide.as_ptr(), &mut count);
        if argv.is_null() {
            return vec![];
        }
        let result = (0..count as usize)
            .map(|i| wide_string(*argv.add(i)))
            .collect();
        LocalFree(argv as *mut c_void);
        result
    }
}

pub fn resolve_input(command: &str, cwd: Option<&std::path::Path>) -> Option<PathBuf> {
    let argument = split_command(command)
        .into_iter()
        .skip(1)
        .find(|arg| arg.to_ascii_lowercase().ends_with(".fst") || arg.to_ascii_lowercase().ends_with(".fstf"))?;
    let input = PathBuf::from(argument);
    if input.is_absolute() {
        Some(input)
    } else {
        cwd.map(|dir| dir.join(input))
    }
}

unsafe fn wide_string(ptr: *const u16) -> String {
    let mut length = 0;
    while length < 32768 && *ptr.add(length) != 0 {
        length += 1;
    }
    String::from_utf16_lossy(std::slice::from_raw_parts(ptr, length))
}

unsafe fn read_bytes(handle: HANDLE, address: usize, length: usize) -> Result<Vec<u8>, String> {
    if address == 0 || length > 65536 {
        return Err("无效进程参数".into());
    }
    let mut bytes = vec![0u8; length];
    let mut count = 0;
    if ReadProcessMemory(
        handle,
        address as *const c_void,
        bytes.as_mut_ptr() as *mut c_void,
        length,
        &mut count,
    ) == 0
        || count != length
    {
        return Err(format!(
            "无法读取进程参数：{}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(bytes)
}

unsafe fn read_pointer(handle: HANDLE, address: usize, width: usize) -> Result<usize, String> {
    let b = read_bytes(handle, address, width)?;
    Ok(if width == 8 {
        u64::from_le_bytes(b.try_into().unwrap()) as usize
    } else {
        u32::from_le_bytes(b.try_into().unwrap()) as usize
    })
}

unsafe fn read_unicode(handle: HANDLE, address: usize, width: usize) -> Result<String, String> {
    let descriptor = read_bytes(handle, address, if width == 8 { 16 } else { 8 })?;
    let length = u16::from_le_bytes([descriptor[0], descriptor[1]]) as usize;
    if length == 0 {
        return Ok(String::new());
    }
    if !length.is_multiple_of(2) {
        return Err("进程字符串长度无效".into());
    }
    let pointer_offset = if width == 8 { 8 } else { 4 };
    let pointer = if width == 8 {
        u64::from_le_bytes(
            descriptor[pointer_offset..pointer_offset + 8]
                .try_into()
                .unwrap(),
        ) as usize
    } else {
        u32::from_le_bytes(
            descriptor[pointer_offset..pointer_offset + 4]
                .try_into()
                .unwrap(),
        ) as usize
    };
    let bytes = read_bytes(handle, pointer, length)?;
    Ok(String::from_utf16_lossy(
        &bytes
            .as_chunks::<2>()
            .0
            .iter()
            .map(|b| u16::from_le_bytes([b[0], b[1]]))
            .collect::<Vec<_>>(),
    ))
}

unsafe fn parameters(handle: HANDLE) -> Result<(String, PathBuf), String> {
    // x64 process: PEB.ProcessParameters 0x20, CurrentDirectory 0x38, CommandLine 0x70.
    // WOW64 process: obtain its 32-bit PEB with ProcessWow64Information (26).
    // These native layouts are isolated here; any read failure is surfaced in the task row.
    let mut wow = 0;
    if IsWow64Process(handle, &mut wow) == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    let (peb, width) = if wow != 0 {
        let mut peb: usize = 0;
        let status = NtQueryInformationProcess(
            handle,
            26,
            &mut peb as *mut _ as *mut c_void,
            size_of::<usize>() as u32,
            std::ptr::null_mut(),
        );
        if status < 0 || peb == 0 {
            return Err("无法读取 WOW64 PEB".into());
        }
        (peb, 4)
    } else {
        let mut info = [0usize; 6];
        let status = NtQueryInformationProcess(
            handle,
            0,
            info.as_mut_ptr() as *mut c_void,
            size_of::<[usize; 6]>() as u32,
            std::ptr::null_mut(),
        );
        if status < 0 {
            return Err(format!("无法查询 PEB：NTSTATUS={status:#x}"));
        }
        (info[1], 8)
    };
    let params = read_pointer(handle, peb + if width == 8 { 0x20 } else { 0x10 }, width)?;
    let command = read_unicode(handle, params + if width == 8 { 0x70 } else { 0x40 }, width)?;
    let cwd = read_unicode(handle, params + if width == 8 { 0x38 } else { 0x24 }, width)?;
    Ok((command, PathBuf::from(cwd)))
}

fn filetime_seconds(time: FILETIME) -> f64 {
    let ticks = ((time.dwHighDateTime as u64) << 32) | time.dwLowDateTime as u64;
    ticks.saturating_sub(116_444_736_000_000_000) as f64 / 10_000_000.0
}

pub fn discover() -> Result<Vec<Process>, String> {
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let snapshot = OwnedHandle(snapshot);
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        let mut result = Vec::new();
        let mut more = Process32FirstW(snapshot.0, &mut entry);
        while more != 0 {
            let name = String::from_utf16_lossy(
                &entry.szExeFile[..entry
                    .szExeFile
                    .iter()
                    .position(|&v| v == 0)
                    .unwrap_or(entry.szExeFile.len())],
            );
            let lower = name.to_ascii_lowercase();
            let configured = std::env::var("OPENFAST_MONITOR_EXE").unwrap_or_default();
            let expected = std::path::Path::new(&configured).file_name().map(|s| s.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
            if entry.th32ProcessID != std::process::id() && ((lower.contains("openfast") && (!lower.contains("monitor") || lower.contains("fixture"))) || (!expected.is_empty() && lower == expected)) {
                let mut process = Process {
                    pid: entry.th32ProcessID,
                    executable: name.clone(),
                    name,
                    started: 0.0,
                    command: String::new(),
                    cwd: None,
                    input: None,
                    error: String::new(),
                };
                let handle =
                    OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, process.pid);
                if handle.is_null() {
                    process.error = format!(
                        "无法读取任务目录/命令行（权限或进程已退出）：{}",
                        std::io::Error::last_os_error()
                    );
                } else {
                    let handle = OwnedHandle(handle);
                    let mut image = vec![0u16; 32768];
                    let mut length = image.len() as u32;
                    if QueryFullProcessImageNameW(handle.0, 0, image.as_mut_ptr(), &mut length) != 0 { process.executable = String::from_utf16_lossy(&image[..length as usize]); }
                    let mut created: FILETIME = std::mem::zeroed();
                    let mut exited = created;
                    let mut kernel = created;
                    let mut user = created;
                    if GetProcessTimes(handle.0, &mut created, &mut exited, &mut kernel, &mut user)
                        != 0
                    {
                        process.started = filetime_seconds(created);
                    }
                    match parameters(handle.0) {
                        Ok((command, cwd)) => {
                            process.input = resolve_input(&command, Some(&cwd));
                            process.command = command;
                            process.cwd = Some(cwd);
                            if process.input.is_none() {
                                process.error = "命令行中未找到 .fst 输入参数".into();
                            }
                        }
                        Err(e) => process.error = e,
                    }
                }
                result.push(process);
            }
            more = Process32NextW(snapshot.0, &mut entry);
        }
        result.sort_by_key(|p| p.pid);
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quoted_chinese_relative_input() {
        let input = resolve_input(
            r#""C:\Program Files\openfast.exe" "子目录\中文 工况.fst""#,
            Some(std::path::Path::new(r"E:\实验")),
        );
        assert_eq!(input, Some(PathBuf::from(r"E:\实验\子目录\中文 工况.fst")));
    }
    #[test]
    fn absolute_input_without_cwd() {
        assert_eq!(
            resolve_input(r#"openfast.exe "E:\案例\test.fst""#, None),
            Some(PathBuf::from(r"E:\案例\test.fst"))
        );
        assert_eq!(resolve_input("openfast.exe test.fst", None), None);
    }
    #[test]
    fn does_not_treat_executable_as_input() {
        assert!(resolve_input("openfast.fst", None).is_none());
    }
}
