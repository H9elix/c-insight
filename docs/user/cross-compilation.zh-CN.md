# C Insight 交叉编译与嵌入式工程配置

本文对应 C Insight `0.22.17`，说明裸机和嵌入式 Linux 工程如何向 clangd 或 Microsoft C/C++ language service (cpptools) 提供真实目标配置。C Insight 是源码导航工具，不会执行 CMake、Make、编译、链接、下载或烧写操作。

## 1. 配置目标

交叉编译发生在开发主机上，但源码面向另一种 CPU、ABI 或操作系统。语义引擎至少需要知道：

- 每个源文件实际使用的 C/C++ 编译器和工作目录；
- `--target`、`-march`、`-mcpu`、`-mthumb`、FPU 和浮点 ABI 等目标参数；
- `--sysroot`、`-I`、`-iquote`、`-isystem` 和强制包含文件；
- 芯片型号、板级配置、Kconfig 等产生的 `-D` 宏；
- C/C++ 标准以及生成头文件的位置。

首选事实源是构建系统生成的 `compile_commands.json`。clangd 根据其中的虚拟编译命令配置解析器；C Insight 只选择数据库目录，不修改或执行数据库条目。clangd 官方的[编译命令说明](https://clangd.llvm.org/design/compile-commands)列出了语言、目标、包含路径和宏等关键参数。

## 2. 推荐配置流程

1. 在 VS Code Extension Host 所在的 Local、WSL、SSH 主机或容器中安装或挂载交叉工具链及目标开发头文件。
2. 先完成一次工程配置或构建，生成 Kconfig、设备树、RPC、HAL 等派生头文件。
3. 使用真实交叉编译设置生成 `compile_commands.json`。
4. 在工作区设置中选择数据库目录，并用窄范围的 `--query-driver` 允许 clangd 查询可信编译器。
5. 只有在真实命令仍不能被 clangd 正确解释时，才用项目根目录 `.clangd` 添加或移除少量参数。
6. 在工程诊断（Project Diagnostics）和 `C Insight: clangd` 日志中核对当前文件最终采用的命令。

## 3. 生成编译数据库

### CMake

已有工具链文件时执行：

```sh
cmake -S . -B build \
  -DCMAKE_TOOLCHAIN_FILE=cmake/arm-none-eabi.cmake \
  -DCMAKE_EXPORT_COMPILE_COMMANDS=ON
```

裸机 ARM 工具链文件通常至少包含：

```cmake
set(CMAKE_SYSTEM_NAME Generic)
set(CMAKE_SYSTEM_PROCESSOR arm)
set(CMAKE_C_COMPILER /opt/arm-gnu/bin/arm-none-eabi-gcc)
set(CMAKE_CXX_COMPILER /opt/arm-gnu/bin/arm-none-eabi-g++)
set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)
```

嵌入式 Linux 工具链文件还可以显式设置：

```cmake
set(CMAKE_SYSTEM_NAME Linux)
set(CMAKE_SYSTEM_PROCESSOR aarch64)
set(CMAKE_C_COMPILER /opt/sdk/bin/aarch64-linux-gnu-gcc)
set(CMAKE_CXX_COMPILER /opt/sdk/bin/aarch64-linux-gnu-g++)
set(CMAKE_SYSROOT /opt/sdk/sysroots/aarch64-linux-gnu)
set(CMAKE_FIND_ROOT_PATH /opt/sdk/sysroots/aarch64-linux-gnu)
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)
```

应检查 `build/compile_commands.json` 中的编译器、目标、sysroot、宏和包含目录是否与真实构建一致。

### Make、自定义脚本与厂商工程

可用构建系统自身的导出能力，或在确实需要时使用 Bear 等工具拦截一次真实构建：

```sh
bear -- make clean all
```

Keil、IAR、MPLAB、厂商 IDE 或自定义构建日志需要转换为 clang 可理解的数据库。不要长期手工编辑生成文件，因为下一次配置或构建通常会覆盖它。使用编译器包装器或 `ccache` 时，要确认数据库的驱动位置仍能让 clangd 找到实际交叉编译器；必要时生成一份不经过包装器的分析专用数据库。

## 4. clangd 模式

`.vscode/settings.json` 示例：

```json
{
  "cInsight.engine": "clangd",
  "cInsight.clangd.path": "/usr/bin/clangd-20",
  "cInsight.compileCommandsDir": "build",
  "cInsight.clangd.arguments": [
    "--query-driver=/opt/arm-gnu/bin/arm-none-eabi-gcc,/opt/arm-gnu/bin/arm-none-eabi-g++"
  ],
  "cInsight.backgroundIndex": true
}
```

`cInsight.compileCommandsDir` 是包含 `compile_commands.json` 的目录。相对路径按第一个工作区根目录解析，也可写绝对路径；当前实现不会展开该字段中的 `${workspaceFolder}`，因此应写 `"build"`，而不是 `"${workspaceFolder}/build"`。

`cInsight.clangd.arguments` 是 clangd 服务进程参数。`--query-driver` 只是受信任驱动的允许列表，真正被查询的程序仍来自编译命令的第一个参数。尽量列出明确绝对路径；不要允许整个工作区或不可信目录，因为 clangd 会执行匹配驱动以提取目标和系统头文件路径。clangd 官方的[系统头文件说明](https://clangd.llvm.org/guides/system-headers)详细描述了这一行为。

不要把以下编译参数直接写入 `cInsight.clangd.arguments`：

```text
--sysroot=...
--target=...
-mcpu=...
-mthumb
-D...
-I...
```

它们应出现在 `compile_commands.json`、`compile_flags.txt`、`.clangd` 的 `CompileFlags` 或仅用于无数据库文件的 `cInsight.fallbackFlags` 中。

## 5. 裸机示例

数据库中的典型命令是：

```text
/opt/arm-gnu/bin/arm-none-eabi-gcc
-mcpu=cortex-m4
-mthumb
-mfpu=fpv4-sp-d16
-mfloat-abi=hard
-DSTM32F407xx
-I.../CMSIS/Include
-I.../Drivers/Inc
-std=gnu17
-c src/main.c
```

`arm-none-eabi-gcc` 可能通过相对于自身安装目录的规则找到 Newlib、libgcc 和内建头文件，即使 `-print-sysroot` 为空也不一定配置错误。最终应查看实际头文件搜索目录：

```sh
/opt/arm-gnu/bin/arm-none-eabi-gcc -dumpmachine
/opt/arm-gnu/bin/arm-none-eabi-gcc -print-sysroot
/opt/arm-gnu/bin/arm-none-eabi-gcc -E -v -x c /dev/null
/opt/arm-gnu/bin/arm-none-eabi-g++ -E -v -x c++ /dev/null
```

目标应为 ARM EABI，搜索目录应位于交叉工具链、CMSIS、SDK 或工程中，而不是宿主机的 x86_64 C/C++ 头文件目录。

## 6. 嵌入式 Linux 与 sysroot

sysroot 是目标 Linux 的开发文件根目录，例如：

```text
/opt/sdk/sysroots/aarch64-linux-gnu/
├── lib/
└── usr/
    ├── include/
    └── lib/
```

运行时 rootfs 往往不包含开发头文件，不能直接替代 SDK sysroot。数据库条目应尽量显式记录：

```text
/opt/sdk/bin/aarch64-linux-gnu-gcc
--sysroot=/opt/sdk/sysroots/aarch64-linux-gnu
-march=armv8-a
-I.../project/include
-c src/main.c
```

若工具链本身已内置正确搜索规则，命令可以没有显式 `--sysroot`。判断标准不是 `-print-sysroot` 必须非空，而是：

```sh
/opt/sdk/bin/aarch64-linux-gnu-gcc -dumpmachine
/opt/sdk/bin/aarch64-linux-gnu-gcc -print-sysroot
/opt/sdk/bin/aarch64-linux-gnu-gcc -E -v -x c /dev/null
```

最终目标三元组、libc/C++ 头文件和 ABI 必须属于目标系统。发行版 multiarch 交叉编译器可能报告 `/`，同时正确搜索 `/usr/aarch64-linux-gnu/include`；可重定位工具链可能根据自身位置定位 sysroot；Yocto 等 SDK 则常由 `environment-setup-*` 脚本显式追加 `--sysroot`。

如果只有执行环境脚本后才正确，应从相同环境生成数据库，并优先确保 `--sysroot` 被记录。仅在已经加载环境的终端中运行成功，并不能保证先前启动的 VS Code Extension Host 继承了这些变量。

## 7. `.clangd` 修正

数据库没有表达目标信息时，可以在工程根目录添加：

```yaml
CompileFlags:
  Add:
    - --target=arm-none-eabi
    - -mcpu=cortex-m4
    - -mthumb
    - -mfpu=fpv4-sp-d16
    - -mfloat-abi=hard
    - -DSTM32F407xx
```

嵌入式 Linux 示例：

```yaml
CompileFlags:
  Add:
    - --target=aarch64-linux-gnu
    - --sysroot=/opt/sdk/sysroots/aarch64-linux-gnu
```

遇到 Clang 不认识的厂商参数时，只删除已经确认不影响解析的选项：

```yaml
CompileFlags:
  Remove:
    - --specs=*
    - --vendor-option=*
```

不要用大范围规则删除 `-mcpu`、ABI、包含路径或宏。`.clangd` 的 `Compiler`、`Add`、`Remove` 和按路径条件配置见 [clangd 配置参考](https://clangd.llvm.org/config)。

## 8. Microsoft 模式

C Insight 的 `cInsight.compileCommandsDir` 不会自动替 cpptools 选择数据库。需要额外配置 `.vscode/c_cpp_properties.json`：

```json
{
  "configurations": [
    {
      "name": "Embedded ARM",
      "compilerPath": "/opt/arm-gnu/bin/arm-none-eabi-gcc",
      "compileCommands": [
        "${workspaceFolder}/build/compile_commands.json"
      ],
      "intelliSenseMode": "linux-gcc-arm",
      "compilerArgs": [
        "-mcpu=cortex-m4",
        "-mthumb"
      ],
      "cStandard": "gnu17",
      "cppStandard": "gnu++17"
    }
  ],
  "version": 4
}
```

同时设置：

```json
{
  "cInsight.engine": "microsoft",
  "C_Cpp.intelliSenseEngine": "default"
}
```

对于有匹配数据库条目的文件，cpptools 优先使用该命令；没有条目时退回 `c_cpp_properties.json` 的基础配置。Microsoft 官方的[交叉编译配置](https://code.visualstudio.com/docs/cpp/configure-intellisense-crosscompilation)和 [C/C++ 配置参考](https://code.visualstudio.com/docs/cpp/customize-cpp-settings)说明了 `compilerPath`、`compilerArgs`、`compileCommands` 和目标架构模式。

## 9. Remote、容器与路径一致性

- WSL/Remote SSH 中，工具链、数据库、sysroot 和生成头文件路径必须对远端扩展宿主可访问；Windows 本地路径不能直接用于 WSL 中的 clangd。
- Dev Container 中优先把 VS Code 扩展也运行在容器内，或者把源码、构建目录和工具链挂载到与数据库记录一致的位置。
- 容器内生成的绝对路径若在宿主环境不存在，需要保持相同挂载点或重新生成数据库，不能只复制 JSON。
- clangd 无法调用只存在于目标设备上的编译器；开发主机必须有可执行的交叉驱动，或者显式提供 Clang 可理解的目标和头文件配置。
- query driver 依赖 shell alias 或未继承环境时可能失败。数据库的第一个参数应是可执行文件，不是只在交互式终端中存在的 alias。

## 10. C Insight 能力边界

- Project Diagnostics 可以显示数据库选择、当前文件命令、工作目录、编译器、语言、标准、显式 include、宏、强制包含和响应文件，但不会替构建系统判断工具链 ABI 是否正确。
- clangd 可以从 query driver 学到目标和系统头文件路径，但这些内部路径不通过标准 LSP 暴露。C Insight 的本地包含层次只使用源码、工作区和数据库中显式的 `-iquote/-I/-isystem`，因此系统头语义导航正确时，包含文件（Includes）仍可能把仅由 query driver 提供的系统头标为 unresolved。完整 builtin/query-driver 路径接入仍在备忘录中。
- 链接脚本、启动汇编、运行时动态装载和烧写流程不属于当前 C/C++ 语义模型。
- IAR、老 ARMCC、XC8 等私有语言扩展可能无法由 Clang 前端完整解析；需要转换参数、补宏或维护分析专用数据库，仍无法保证完全兼容。

## 11. 验证清单

1. `compile_commands.json` 中当前源文件有直接条目。
2. 命令第一个参数是正确的交叉编译器，而不是宿主编译器或失效包装器。
3. 工作目录和所有绝对路径在当前扩展宿主中存在。
4. 目标 CPU、ABI、sysroot、项目宏和生成头文件路径与固件构建一致。
5. `--query-driver` 只允许可信工具链，并与数据库中的驱动路径匹配。
6. 工程诊断没有把代表性源文件标为 `fallback`。
7. `C Insight: clangd` 显示 `Compile command from CDB` 或 `ASTWorker building file ... with command`，而不是 `Generic fallback command`。
8. 后台索引完成后，再验证跨文件定义、引用、调用者和被调用者。

可在命令行复核一个源文件：

```sh
clangd-20 \
  --check=/absolute/project/src/main.c \
  --compile-commands-dir=/absolute/project/build \
  '--query-driver=/opt/arm-gnu/bin/arm-none-eabi-*'
```

如果命令行检查与 C Insight 表现不同，应比较 VS Code Extension Host 的路径、环境、选中数据库和 `C Insight: clangd` 启动参数。
