# C Insight Cross-compilation and Embedded Projects

This guide applies to C Insight `0.22.16`. C Insight provides source navigation; it never configures or runs CMake, Make, compilation, linking, deployment, or flashing.

## Required project evidence

The analysis engine needs the real command for each translation unit: cross-compiler and working directory, target CPU/ABI flags, sysroot, include paths, preprocessor definitions, language standard, and generated headers. A build-generated `compile_commands.json` is the preferred source. See clangd's [compile-command design](https://clangd.llvm.org/design/compile-commands).

Generate the database only after configuring the real target and creating Kconfig, device-tree, RPC, HAL, or other generated headers. For CMake:

```sh
cmake -S . -B build \
  -DCMAKE_TOOLCHAIN_FILE=cmake/arm-none-eabi.cmake \
  -DCMAKE_EXPORT_COMPILE_COMMANDS=ON
```

For Make or a custom build, use its native export facility or capture one real build with a tool such as Bear. Vendor IDE logs may require conversion to a Clang-compatible analysis database. Avoid hand-editing generated JSON.

## clangd mode

Use workspace settings such as:

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

`cInsight.compileCommandsDir` names the directory containing `compile_commands.json`. A relative value is resolved against the first workspace folder; the current setting does not interpolate `${workspaceFolder}`, so use `"build"` or an absolute path.

`cInsight.clangd.arguments` contains clangd process options. `--query-driver` only allowlists trusted compiler drivers; the actual driver still comes from the compile command. Use narrow absolute paths because clangd executes matching drivers to extract target and system-header information. See clangd's [system-header guide](https://clangd.llvm.org/guides/system-headers).

Compiler options such as `--sysroot`, `--target`, `-mcpu`, `-mthumb`, `-D`, and `-I` belong in the compilation database, `compile_flags.txt`, `.clangd` `CompileFlags`, or last-resort fallback flags. They are not clangd server options and must not be placed directly in `cInsight.clangd.arguments`.

## Bare-metal targets

A Cortex-M command typically contains:

```text
/opt/arm-gnu/bin/arm-none-eabi-gcc
-mcpu=cortex-m4
-mthumb
-mfpu=fpv4-sp-d16
-mfloat-abi=hard
-DSTM32F407xx
-I.../CMSIS/Include
-std=gnu17
-c src/main.c
```

An Arm GNU toolchain may find Newlib and builtin headers relative to its installation even when `-print-sysroot` is empty. Verify the effective target and search paths instead of relying on that one value:

```sh
/opt/arm-gnu/bin/arm-none-eabi-gcc -dumpmachine
/opt/arm-gnu/bin/arm-none-eabi-gcc -print-sysroot
/opt/arm-gnu/bin/arm-none-eabi-gcc -E -v -x c /dev/null
/opt/arm-gnu/bin/arm-none-eabi-g++ -E -v -x c++ /dev/null
```

## Embedded Linux and sysroots

A development sysroot is the target Linux header/library root, for example `/opt/sdk/sysroots/aarch64-linux-gnu`. A runtime root filesystem often lacks development headers and is not automatically a suitable sysroot. Prefer commands that record:

```text
/opt/sdk/bin/aarch64-linux-gnu-gcc
--sysroot=/opt/sdk/sysroots/aarch64-linux-gnu
-march=armv8-a
-c src/main.c
```

An explicit `--sysroot` is not mandatory when the driver already has correct built-in or relocatable search rules. `-print-sysroot` may return `/` for a valid distribution multiarch compiler or be empty for some bundled toolchains. The authoritative check is the target triple and the C/C++ paths printed by `-E -v`; they must match the target libc, C++ ABI, and architecture rather than host x86_64 headers.

SDK environment scripts, especially Yocto-style `environment-setup-*`, often append `--sysroot` rather than embedding it in the compiler. Generate the database from that environment and prefer recording the option explicitly. A VS Code process started before sourcing the SDK environment does not inherit later terminal changes.

## `.clangd` corrections

Use a project-root `.clangd` only for missing or incompatible flags:

```yaml
CompileFlags:
  Add:
    - --target=aarch64-linux-gnu
    - --sysroot=/opt/sdk/sysroots/aarch64-linux-gnu
  Remove:
    - --specs=*
    - --vendor-option=*
```

Remove only confirmed Clang-incompatible vendor flags. Do not broadly remove target, ABI, include, or define options. See the clangd [configuration reference](https://clangd.llvm.org/config).

## Microsoft mode

`cInsight.compileCommandsDir` does not configure cpptools. Configure `.vscode/c_cpp_properties.json` separately:

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

Set `cInsight.engine` to `microsoft`, keep `C_Cpp.intelliSenseEngine` at `default`, and reload the window. Matching compilation-database entries override the cpptools base configuration; files without entries fall back to `compilerPath`, `compilerArgs`, includes, and defines. See Microsoft's [cross-compilation guide](https://code.visualstudio.com/docs/cpp/configure-intellisense-crosscompilation) and [settings reference](https://code.visualstudio.com/docs/cpp/customize-cpp-settings).

## Remote and current limitations

- Toolchain, database, sysroot, and generated paths must exist in the Local/WSL/SSH/container extension host. Host Windows paths are not valid inside WSL clangd.
- A database copied from another container or machine is unusable when its absolute paths do not exist; preserve mount points or regenerate it.
- C Insight does not analyze linker scripts, flashing, or runtime loading as C/C++ semantics.
- clangd may learn builtin paths from a query driver, but standard LSP does not expose them to C Insight's local Include Hierarchy resolver. Explicit `-iquote`, `-I`, and `-isystem` paths are used there; query-driver-only system headers may still appear unresolved in Includes even while clangd navigation works.
- Proprietary IAR, legacy ARMCC, XC8, and similar syntax may require a translated analysis database and macro compatibility and may remain incomplete in Clang.

## Verification

Project Diagnostics should show the selected database, a direct command for a representative source file, the cross compiler, working directory, target flags, includes, and defines. The `C Insight: clangd` log should report `Compile command from CDB` or `ASTWorker building file ... with command`, not `Generic fallback command`.

You can check one source file directly:

```sh
clangd-20 \
  --check=/absolute/project/src/main.c \
  --compile-commands-dir=/absolute/project/build \
  '--query-driver=/opt/arm-gnu/bin/arm-none-eabi-*'
```

Wait for background indexing before judging cross-file References, Callers, or Callees completeness.
