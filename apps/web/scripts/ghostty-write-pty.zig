// The import name is part of the ABI of the vendored ghostty-write-pty.wasm,
// which the repository ships prebuilt. Renaming it here would need the wasm
// rebuilt with Zig, so the t3 spelling stays until that happens.
extern "env" fn t3_write_pty(terminal: u32, userdata: u32, data: u32, len: u32) void;

export fn ghostty_write_pty(terminal: u32, userdata: u32, data: u32, len: u32) void {
    t3_write_pty(terminal, userdata, data, len);
}
