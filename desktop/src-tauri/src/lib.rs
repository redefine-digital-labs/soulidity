mod persona_install;

use std::fs;
use std::path::PathBuf;

use persona_install::{
    install_persona_at_path, load_active_persona_at_path, load_installed_personas_at_path,
    set_active_persona_at_path, ActivePersonaRecord, DesktopPersonaManifest,
    InstalledPersonaRecord,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{path::BaseDirectory, AppHandle, Manager};

#[derive(Serialize)]
struct DesktopShellStatus {
    runtime: &'static str,
    phase: &'static str,
    routes: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthSessionRecord {
    account_id: String,
    device_code: String,
    user_code: Option<String>,
    confirmed_at: String,
    expires_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopDeviceStartResponse {
    device_code: String,
    user_code: String,
    expires_at: String,
    poll_interval: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum DesktopDevicePollResponse {
    Pending {
        #[serde(rename = "expiresAt")]
        expires_at: String,
        #[serde(rename = "pollInterval")]
        poll_interval: u64,
    },
    Confirmed {
        #[serde(rename = "accountId")]
        account_id: String,
        #[serde(rename = "deepLink")]
        deep_link: Option<String>,
        #[serde(rename = "expiresAt")]
        expires_at: String,
        #[serde(rename = "pollInterval")]
        poll_interval: u64,
    },
    Expired {
        #[serde(rename = "expiresAt")]
        expires_at: String,
        #[serde(rename = "pollInterval")]
        poll_interval: u64,
    },
    #[serde(rename = "invalid_code")]
    InvalidCode {
        #[serde(rename = "expiresAt")]
        expires_at: Option<String>,
        #[serde(rename = "pollInterval")]
        poll_interval: u64,
    },
}

#[tauri::command]
fn desktop_shell_status() -> DesktopShellStatus {
    DesktopShellStatus {
        runtime: "tauri",
        phase: "phase-1-shell",
        routes: 7,
    }
}

fn normalize_web_base_url(web_base_url: &str) -> Result<String, String> {
    let trimmed = web_base_url.trim();
    if trimmed.is_empty() {
        return Err("webBaseUrl is required".to_string());
    }

    Ok(trimmed.trim_end_matches('/').to_string())
}

async fn parse_error_response(response: reqwest::Response) -> String {
    let status = response.status();
    let response_text = response.text().await.unwrap_or_default();

    if let Ok(body) = serde_json::from_str::<serde_json::Value>(&response_text) {
        if let Some(message) = body.get("error").and_then(|value| value.as_str()) {
            return format!("Desktop auth request failed ({status}): {message}");
        }
    }

    format!("Desktop auth request failed ({status})")
}

#[tauri::command]
async fn start_device_authorization(
    web_base_url: String,
) -> Result<DesktopDeviceStartResponse, String> {
    let normalized_base_url = normalize_web_base_url(&web_base_url)?;
    let url = format!("{normalized_base_url}/api/desktop/device/start");
    let response = Client::new()
        .post(url)
        .send()
        .await
        .map_err(|error| format!("Failed to call desktop device start API: {error}"))?;

    if !response.status().is_success() {
        return Err(parse_error_response(response).await);
    }

    response
        .json::<DesktopDeviceStartResponse>()
        .await
        .map_err(|error| format!("Failed to decode desktop device start response: {error}"))
}

#[tauri::command]
async fn poll_device_authorization(
    web_base_url: String,
    device_code: String,
) -> Result<DesktopDevicePollResponse, String> {
    let normalized_base_url = normalize_web_base_url(&web_base_url)?;
    let normalized_device_code = device_code.trim();
    if normalized_device_code.is_empty() {
        return Err("deviceCode is required".to_string());
    }

    let url = format!("{normalized_base_url}/api/desktop/device/poll");
    let response = Client::new()
        .post(url)
        .json(&serde_json::json!({
            "deviceCode": normalized_device_code,
        }))
        .send()
        .await
        .map_err(|error| format!("Failed to call desktop device poll API: {error}"))?;

    if !response.status().is_success() {
        return Err(parse_error_response(response).await);
    }

    response
        .json::<DesktopDevicePollResponse>()
        .await
        .map_err(|error| format!("Failed to decode desktop device poll response: {error}"))
}

fn auth_session_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve("state/auth_session.json", BaseDirectory::AppData)
        .map_err(|error| format!("Failed to resolve desktop auth session path: {error}"))
}

fn desktop_app_data_root(app: &AppHandle) -> Result<PathBuf, String> {
    let state_dir = app
        .path()
        .resolve("state", BaseDirectory::AppData)
        .map_err(|error| format!("Failed to resolve desktop state directory: {error}"))?;

    state_dir
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| "Failed to resolve desktop app data root".to_string())
}

#[tauri::command]
fn load_auth_session(app: AppHandle) -> Result<Option<AuthSessionRecord>, String> {
    let path = auth_session_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }

    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read desktop auth session file: {error}"))?;

    serde_json::from_str::<AuthSessionRecord>(&contents)
        .map(Some)
        .map_err(|error| format!("Failed to decode desktop auth session file: {error}"))
}

#[tauri::command]
fn save_auth_session(app: AppHandle, session: AuthSessionRecord) -> Result<(), String> {
    let path = auth_session_path(&app)?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create desktop auth session directory: {error}"))?;
    }

    let payload = serde_json::to_string_pretty(&session)
        .map_err(|error| format!("Failed to encode desktop auth session: {error}"))?;

    fs::write(path, payload)
        .map_err(|error| format!("Failed to write desktop auth session file: {error}"))
}

#[tauri::command]
fn clear_auth_session(app: AppHandle) -> Result<(), String> {
    let path = auth_session_path(&app)?;
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("Failed to clear desktop auth session file: {error}"))?;
    }

    Ok(())
}

#[tauri::command]
async fn install_persona(
    app: AppHandle,
    manifest: DesktopPersonaManifest,
) -> Result<InstalledPersonaRecord, String> {
    let app_data_root = desktop_app_data_root(&app)?;
    install_persona_at_path(&app_data_root, manifest, &Client::new()).await
}

#[tauri::command]
fn load_installed_personas(app: AppHandle) -> Result<Vec<InstalledPersonaRecord>, String> {
    let app_data_root = desktop_app_data_root(&app)?;
    load_installed_personas_at_path(&app_data_root)
}

#[tauri::command]
fn load_active_persona(app: AppHandle) -> Result<Option<ActivePersonaRecord>, String> {
    let app_data_root = desktop_app_data_root(&app)?;
    load_active_persona_at_path(&app_data_root)
}

#[tauri::command]
fn set_active_persona(app: AppHandle, persona_id: String) -> Result<ActivePersonaRecord, String> {
    let app_data_root = desktop_app_data_root(&app)?;
    set_active_persona_at_path(&app_data_root, &persona_id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            desktop_shell_status,
            start_device_authorization,
            poll_device_authorization,
            load_auth_session,
            save_auth_session,
            clear_auth_session,
            install_persona,
            load_installed_personas,
            load_active_persona,
            set_active_persona
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
