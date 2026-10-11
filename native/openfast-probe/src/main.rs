mod process;
fn main() {
    match process::discover() {
        Ok(items) => {
            let rows: Vec<_> = items.iter().map(|p| serde_json::json!({
                "ProcessId": p.pid, "Name": p.name, "ExecutablePath": p.executable,
                "StartedAt": if p.started > 0.0 { Some(p.started * 1000.0) } else { None },
                "CommandLine": p.command, "Cwd": p.cwd, "InputPath": p.input, "ParameterError": p.error
            })).collect();
            println!("{}", serde_json::to_string(&rows).unwrap());
        }
        Err(error) => { eprintln!("{error}"); std::process::exit(1); }
    }
}
