use serde::Serialize;

#[derive(Serialize)]
struct DesktopShellStatus {
    runtime: &'static str,
    phase: &'static str,
    routes: usize,
}

#[tauri::command]
fn desktop_shell_status() -> DesktopShellStatus {
    DesktopShellStatus {
        runtime: "tauri",
        phase: "phase-1-shell",
        routes: 7,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![desktop_shell_status])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
