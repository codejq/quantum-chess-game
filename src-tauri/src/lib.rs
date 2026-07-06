#[tauri::command]
fn platform_info() -> String {
    std::env::consts::OS.to_string()
}

#[tauri::command]
fn close_window(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![platform_info, close_window])
        .run(tauri::generate_context!())
        .expect("error while running Quantum Chess");
}
