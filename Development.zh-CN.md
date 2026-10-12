# 开发说明

## 引用访问与结果读取边界

`src/reference-access.ts` 统一提供 `canReadReference(workspace, uri)`。诊断、文件图、文件链接、路径补全与路径修复在文件系统调用前检查：未信任工作区禁止带 authority 或 UNC/设备路径形式的 file URI；可信工作区与现有远程文件系统提供者保持原有行为。回归测试仅记录模拟文件系统调用，不连接真实网络共享。

`readResultMetadata(filename, signal?)` 与时序数据解析共用有界 `resultLines`。文本元数据每行上限为 1,000,000 字节，累计文件头扫描上限为 4,000,000 字节；数据行保留 32,000,000 字节上限。完整超长行与未结束行均在解码前拒绝。预览的可取消进度传递 AbortSignal，取消时关闭待处理流。测试覆盖访问策略、自动检查、文件链接、超长行、累计文件头限制、取消、UTF-8 及 LF/CRLF/CR；在项目根目录执行 `npm test` 与 `npm run check`，并按下文配置外部工况。测试仍受现有 `test/` 忽略规则影响。

[English](Development.md) | **简体中文**

## 环境与本地构建

以下命令在项目根目录执行。使用 Node.js 24（打包工具要求 Node.js >= 22）及 npm；重建原生探针需要 Windows x64、Rust MSVC 工具链和 Visual Studio C++ 构建工具。扩展运行环境要求见 [README](README.zh-CN.md)。

```powershell
npm ci --ignore-scripts
npm run compile
npm test
npm run check
npm run format:check
# 将下面的占位值替换为实际仓库及分支或提交：
npm run package -- --baseContentUrl "https://github.com/<owner>/<repo>/blob/<ref>/"
```

package.json 已配置仓库 `https://github.com/HCLonely/OpenFAST-Helper`。发布包使用 `npm run package -- --baseContentUrl "https://github.com/HCLonely/OpenFAST-Helper/blob/v1.1.0/"`，将文档链接固定到发布标签；GitHub Actions 自动使用本次提交的内容 URL。

维护官方章节索引时运行 `npm run build:doc-links`（需要联网）；HTML 抓取记录与构建报告位于 `test-results/docs`，不进入安装包。参数词典与章节索引分别保存在 `data/catalog.json`、`data/doc-links.json`，构建参数词典不会覆盖链接索引。

用 VS Code 打开插件目录并按 F5 启动扩展开发宿主。Windows 上也可运行 `scripts/run-host-test.ps1`，它使用独立用户目录和扩展目录执行真实编辑器测试，不安装到日常 VS Code 环境；结果位于 `test-results/host-result.json`。

运行源码使用 TypeScript，编译到 `out/`；入口为 `out/extension.js`。`npm run watch` 持续编译，`npm run format` 统一可读排版，F5 调试前自动编译。共享数据接口在 `src/types.ts`，语言服务在 `src/i18n.ts`，英文词典在 `data/catalog.en.json`，运行时消息分别存放在 `data/ui.zh-CN.json` 与 `data/ui.en.json`，使用相同的语义化英文键，例如 `hover.builtInDescription`、`runner.executableNotFound`。调用 `t('hover.builtInDescription')` 获取当前语言文本；`MessageKey` 类型检查键名，文案和 `{0}` 等占位符仅存放在词典值中。新增语言时扩展语言枚举、消息词典和参数词典，并添加 `package.nls.<locale>.json`。

核心解析器在 `src/parser.ts`，编辑器适配在 `src/extension.ts`，中文词典在 `data/catalog.json`。打包无需 Python；词典生成脚本 `scripts/build_catalog.py` 可在当前研究工作区根据此前的注释资源重新生成词典，已有 JSON 可直接独立使用。

若测试工况位于独立目录，可先设置 `$env:OPENFAST_TEST_CASE_DIR = "工况绝对路径"`，再执行 `npm test` 或宿主测试脚本；该目录需包含实际配置，其相邻 `_中文注释版` 目录用于既有解析回归。

当前 `.gitignore` 忽略 `test/`，上述 JavaScript 测试、格式检查和宿主测试需本地保留该目录；解析回归还依赖外部工况。全新 Git 检出不能直接运行这些测试。若要将它们纳入 CI，需先将测试及可共享的工况样例纳入版本控制，并移除本地路径依赖。

## 文档语言

`README.md` 与 `Development.md` 为默认英文文档，`README.zh-CN.md` 与 `Development.zh-CN.md` 为对应的简体中文版。功能、命令、环境要求或限制变化时，同步维护两种语言。每份文档顶部提供语言切换入口；用户说明与开发说明之间的链接及章节锚点应保持同一语言。

两份 README 均包含在 VSIX 中；两份开发说明均通过 `.vscodeignore` 排除。README 中指向开发说明的链接在打包时通过内容 URL 转为仓库链接。

## 原生探针

源码位于 `native/openfast-probe`，运行时文件为 `bin/openfast-probe.exe`。在项目根目录执行：

```powershell
./scripts/build-process-probe.ps1 -Test
```

Cargo 不在 PATH 时可加 `-CargoPath <cargo路径>`。脚本使用 Cargo.lock 锁定依赖，先运行 Rust 测试，再编译 release 版本并复制到 bin；用户安装 VSIX 后无需 Rust。

## GitHub Actions 自动构建

工作流：`.github/workflows/build.yml`，名称 **Build VSIX**。

- 任意分支或标签推送、PR 创建或更新、手动运行时触发。同一 ref 的新运行会取消尚未结束的旧运行。
- 使用 `windows-2022`、Node.js 24、Windows x64 Rust stable 工具链；用 package-lock.json 缓存 npm 下载并执行 `npm ci --ignore-scripts`。
- 运行 `npm run check`，通过现有 PowerShell 脚本测试并重建原生探针，再通过 `npm run package` 编译 TypeScript 并打包。
- 打包时根据 GitHub 的仓库与提交信息传入 `--baseContentUrl`，将 README 内的相对文档链接指向本次提交；无需在项目内写死仓库地址。
- 检查 VSIX 内的入口文件、参数词典和原生探针，然后上传 `dist/*.vsix`。产物名称为 `openfast-helper-windows-x64-<运行编号>`，保留 30 天。
- 只需仓库读取权限，无需配置额外密钥。下载位置为 **Actions → Build VSIX → 对应运行 → Artifacts**；手动运行入口在工作流页 **Run workflow**，该入口要求工作流已存在于默认分支。

CI 当前执行类型检查、Rust 测试和安装包内容检查；JavaScript 测试及真实 VS Code 宿主测试需上述本地测试资源。工作流生成 VSIX 构建产物，不发布到扩展市场或 GitHub Releases。包中包含 Windows x64 探针，其他平台的功能限制见 README。

发布新版本时，同步 package.json、package-lock.json 和 `package` 脚本的版本化输出路径；工作流通过通配符收集 VSIX，无需修改版本号。

### 排错

- 依赖安装失败：检查 Node.js 版本，以及 package.json 与 package-lock.json 是否同步。
- 原生探针构建失败：检查 MSVC 工具链、C++ 链接器与 Cargo.lock 是否可用；CI 会重建探针，不依赖仓库中的预编译文件。
- 打包失败或没有产物：检查 `npm run package` 日志与输出路径。CI 会先创建 dist 目录，缺失产物会使上传步骤失败。
- 本地测试提示找不到工况：设置 `OPENFAST_TEST_CASE_DIR` 并确认相邻中文注释版目录存在；不需要启动实际 OpenFAST 计算即可打包。

## 性能基准

开发目录执行 `npm run benchmark:editor`，使用生成的小表格、3000 行定义表、1 万个目录候选与超过 2 MB 文档，记录冷注册/首次请求和热请求中位数、p95、候选数及缓存命中，输出 `test-results/editor-benchmark.json`。调用真实补全适配器，但 VS Code 文件系统为模拟接口；不是 GUI 输入延迟。默认只报告，并校验候选和缓存边界，不以耗时令普通测试随机失败。

需要比较基线时，保留旧报告并指定不同输出路径：

```powershell
npm run benchmark:editor -- --baseline test-results/editor-benchmark-baseline.json --out test-results/editor-benchmark-current.json --max-ratio 3
```

比较要求场景哈希、报告格式、Node 主版本、平台、架构和 CPU 型号一致；任一场景的冷/热中位数超过 `max(基线中位数, 5 ms) × 倍数` 时返回失败。倍数默认 3，可自行调整；同机后台负载仍可能影响结果。基线与输出同路径会拒绝执行，避免覆盖基线。

## GitHub Releases 发布

发布 1.1.0 时，先执行上述检查和原生探针构建，再使用 `v1.1.0` 内容 URL 打包。提交并推送源码，创建和推送 `v1.1.0` 标签，然后发布 GitHub Release，附加 `dist/openfast-helper-1.1.0.vsix`。确认发布标签指向已验证的提交。VS Code 扩展市场发布属于独立流程。

## TurbSim 启动入口

`src/turbsim-runner.ts` 注册独立的运行和路径配置命令，`src/run-input.ts` 检查主输入特征。编辑器按钮使用 `openfast.runnableTurbSim` 上下文，文件修改或切换时刷新；资源管理器按扩展名提供入口，执行时再次校验内容。与 OpenFAST 共用 `createRunTask` 和路径存储函数，传入 TurbSim 程序标识，设置为 `openfast.turbSimExecutablePath`，备用存储为 `turbsim.runner.path:<folder URI>`，不覆盖既有 OpenFAST 路径。

TurbSim 使用 ProcessExecution 独立传递输入路径并设置 cwd，不经 shell，不接入仅针对 FST 的预检查、队列或监控。工作区信任、保存、程序文件检查及重复任务保护在启动前执行。只新增 TurbSim 启动，ROSCO 仍无运行入口。

在项目根目录运行 `npm run check`、`npm run compile`，然后运行 `node --test test/turbsim-runner.test.js test/runner.test.js test/i18n.test.js`，验证路径隔离、主/辅助输入区分、参数与工作目录、保存失败、重复启动及中英文资源。测试使用模拟任务接口，不需要实际 TurbSim；新增 TurbSim 测试通过 .gitignore 的单文件例外纳入版本管理，其他已有本地测试仍被忽略。实际计算需用户安装 TurbSim，并在 VS Code 中使用真实主输入验证。
