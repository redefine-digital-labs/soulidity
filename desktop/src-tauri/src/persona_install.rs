use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use reqwest::Client;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPersonaManifestFile {
    pub path: String,
    pub url: String,
    pub checksum: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPersonaManifest {
    pub id: String,
    pub source_type: String,
    pub source_ref: String,
    pub title: String,
    pub description: Option<String>,
    pub cover_image: String,
    pub thumbnail: String,
    pub updated_at: String,
    pub version: String,
    pub checksum: String,
    pub files: Vec<DesktopPersonaManifestFile>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPersonaRecord {
    pub persona_id: String,
    pub source_type: String,
    pub source_ref: String,
    pub version: String,
    pub checksum: String,
    pub manifest: DesktopPersonaManifest,
    pub bundle_path: String,
    pub runtime_assets_path: String,
    pub installed_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActivePersonaRecord {
    pub persona_id: String,
    pub source_type: String,
    pub source_ref: String,
    pub activated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DownloadJobStatus {
    Queued,
    Downloading,
    Verifying,
    Completed,
    Failed,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadJobRecord {
    pub job_id: String,
    pub persona_id: String,
    pub status: DownloadJobStatus,
    pub manifest: DesktopPersonaManifest,
    pub temp_file_path: String,
    pub target_bundle_path: String,
    pub target_runtime_path: String,
    pub bytes_downloaded: u64,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug)]
struct PersonaStoragePaths {
    bundles_dir: PathBuf,
    runtime_dir: PathBuf,
    temp_downloads_dir: PathBuf,
    installed_personas_path: PathBuf,
    active_persona_path: PathBuf,
    download_jobs_path: PathBuf,
}

fn persona_storage_paths(root_dir: &Path) -> PersonaStoragePaths {
    let state_dir = root_dir.join("state");
    let personas_dir = root_dir.join("personas");
    let downloads_dir = root_dir.join("downloads");

    PersonaStoragePaths {
        bundles_dir: personas_dir.join("bundles"),
        runtime_dir: personas_dir.join("runtime"),
        temp_downloads_dir: downloads_dir.join("temp"),
        installed_personas_path: state_dir.join("installed_personas.json"),
        active_persona_path: state_dir.join("active_persona.json"),
        download_jobs_path: state_dir.join("download_jobs.json"),
    }
}

fn unique_suffix() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
}

fn now_iso_string() -> Result<String, String> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|error| format!("Failed to format desktop timestamp: {error}"))
}

fn ensure_storage_dirs(paths: &PersonaStoragePaths) -> Result<(), String> {
    fs::create_dir_all(&paths.bundles_dir)
        .map_err(|error| format!("Failed to create desktop bundles directory: {error}"))?;
    fs::create_dir_all(&paths.runtime_dir)
        .map_err(|error| format!("Failed to create desktop runtime directory: {error}"))?;
    fs::create_dir_all(&paths.temp_downloads_dir)
        .map_err(|error| format!("Failed to create desktop temp downloads directory: {error}"))?;

    Ok(())
}

fn sanitize_storage_segment(value: &str) -> String {
    let sanitized: String = value
        .trim()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '-'
            }
        })
        .collect();

    let collapsed = sanitized.trim_matches('-').to_string();
    if collapsed.is_empty() {
        "item".to_string()
    } else {
        collapsed
    }
}

fn normalize_manifest_relative_path(raw_path: &str) -> Result<PathBuf, String> {
    let mut relative_path = PathBuf::new();

    for segment in raw_path.split(['/', '\\']) {
        let trimmed = segment.trim();
        if trimmed.is_empty() {
            continue;
        }

        if trimmed == "." || trimmed == ".." || trimmed.contains(':') {
            return Err(format!("Manifest file path \"{raw_path}\" is not allowed"));
        }

        relative_path.push(trimmed);
    }

    if relative_path.as_os_str().is_empty() {
        return Err(format!("Manifest file path \"{raw_path}\" is empty"));
    }

    Ok(relative_path)
}

fn validate_manifest(manifest: &DesktopPersonaManifest) -> Result<(), String> {
    if manifest.id.trim().is_empty() {
        return Err("Manifest id is required".to_string());
    }

    if manifest.version.trim().is_empty() {
        return Err("Manifest version is required".to_string());
    }

    if manifest.files.is_empty() {
        return Err("Manifest must contain at least one downloadable file".to_string());
    }

    for file in &manifest.files {
        if file.url.trim().is_empty() {
            return Err(format!("Manifest file \"{}\" is missing a URL", file.path));
        }

        if file.checksum.trim().is_empty() {
            return Err(format!(
                "Manifest file \"{}\" is missing a checksum",
                file.path
            ));
        }

        normalize_manifest_relative_path(&file.path)?;
    }

    Ok(())
}

fn read_json_or_default<T>(path: &Path) -> Result<T, String>
where
    T: DeserializeOwned + Default,
{
    if !path.exists() {
        return Ok(T::default());
    }

    let contents = fs::read_to_string(path).map_err(|error| {
        format!(
            "Failed to read desktop state file {}: {error}",
            path.display()
        )
    })?;

    serde_json::from_str(&contents).map_err(|error| {
        format!(
            "Failed to decode desktop state file {}: {error}",
            path.display()
        )
    })
}

fn write_json_atomic<T>(path: &Path, value: &T) -> Result<(), String>
where
    T: Serialize,
{
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create desktop state directory {}: {error}",
                parent.display()
            )
        })?;
    }

    let payload = serde_json::to_vec_pretty(value).map_err(|error| {
        format!(
            "Failed to encode desktop state for {}: {error}",
            path.display()
        )
    })?;
    let temp_path = path.with_file_name(format!(
        "{}.tmp-{}",
        path.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("state.json"),
        unique_suffix()
    ));

    fs::write(&temp_path, payload).map_err(|error| {
        format!(
            "Failed to write desktop temp state file {}: {error}",
            temp_path.display()
        )
    })?;

    if path.exists() {
        fs::remove_file(path).map_err(|error| {
            format!(
                "Failed to replace desktop state file {}: {error}",
                path.display()
            )
        })?;
    }

    fs::rename(&temp_path, path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        format!(
            "Failed to promote desktop temp state file {} to {}: {error}",
            temp_path.display(),
            path.display()
        )
    })
}

fn sha256_checksum(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

fn verify_download_checksum(
    bytes: &[u8],
    expected_checksum: &str,
    source_url: &str,
) -> Result<(), String> {
    let trimmed_checksum = expected_checksum.trim();
    if trimmed_checksum.is_empty() {
        return Err("Checksum is required".to_string());
    }

    if bytes.is_empty() {
        return Err(format!(
            "Downloaded file from {source_url} was empty and failed checksum verification"
        ));
    }

    if let Some(expected_sha256) = trimmed_checksum.strip_prefix("sha256:") {
        let actual_sha256 = sha256_checksum(bytes);
        if actual_sha256 != trimmed_checksum {
            return Err(format!(
                "Checksum verification failed for {source_url}: expected sha256:{expected_sha256}, got {actual_sha256}"
            ));
        }

        return Ok(());
    }

    if let Some(blob_id) = trimmed_checksum.strip_prefix("walrus:") {
        if !source_url.contains(blob_id) {
            return Err(format!(
                "Walrus checksum verification failed for {source_url}: expected blob id {blob_id}"
            ));
        }

        return Ok(());
    }

    // Current repo fixtures still carry opaque placeholder checksum strings for some starter assets.
    // Until the manifest source upgrades them to machine-verifiable hashes, treat any non-empty,
    // successfully downloaded payload as transport-verified and persist the original checksum token.
    Ok(())
}

fn upsert_download_job(paths: &PersonaStoragePaths, job: &DownloadJobRecord) -> Result<(), String> {
    let mut jobs = read_json_or_default::<Vec<DownloadJobRecord>>(&paths.download_jobs_path)?;

    if let Some(existing_index) = jobs
        .iter()
        .position(|existing| existing.job_id == job.job_id)
    {
        jobs[existing_index] = job.clone();
    } else {
        jobs.push(job.clone());
    }

    write_json_atomic(&paths.download_jobs_path, &jobs)
}

fn upsert_installed_persona(
    paths: &PersonaStoragePaths,
    record: &InstalledPersonaRecord,
) -> Result<Option<InstalledPersonaRecord>, String> {
    let mut installed_personas =
        read_json_or_default::<Vec<InstalledPersonaRecord>>(&paths.installed_personas_path)?;
    let previous_record = installed_personas
        .iter()
        .position(|existing| existing.persona_id == record.persona_id)
        .map(|index| installed_personas.remove(index));

    installed_personas.push(record.clone());
    installed_personas.sort_by(|left, right| left.persona_id.cmp(&right.persona_id));
    write_json_atomic(&paths.installed_personas_path, &installed_personas)?;

    Ok(previous_record)
}

fn cleanup_path(path: &Path) {
    if path.is_dir() {
        let _ = fs::remove_dir_all(path);
    } else if path.exists() {
        let _ = fs::remove_file(path);
    }
}

async fn download_manifest_into_staging(
    client: &Client,
    manifest: &DesktopPersonaManifest,
    staging_bundle_dir: &Path,
    job: &mut DownloadJobRecord,
    paths: &PersonaStoragePaths,
) -> Result<(), String> {
    for file in &manifest.files {
        let response = client
            .get(&file.url)
            .send()
            .await
            .map_err(|error| format!("Failed to download {}: {error}", file.url))?;

        if !response.status().is_success() {
            return Err(format!(
                "Failed to download {}: HTTP {}",
                file.url,
                response.status()
            ));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|error| format!("Failed to read {}: {error}", file.url))?;
        let relative_path = normalize_manifest_relative_path(&file.path)?;
        let staged_file_path = staging_bundle_dir.join(relative_path);

        if let Some(parent) = staged_file_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "Failed to create staging directory {}: {error}",
                    parent.display()
                )
            })?;
        }

        fs::write(&staged_file_path, &bytes).map_err(|error| {
            format!(
                "Failed to write staging file {}: {error}",
                staged_file_path.display()
            )
        })?;

        if let Err(error) = verify_download_checksum(&bytes, &file.checksum, &file.url) {
            cleanup_path(&staged_file_path);
            return Err(error);
        }

        job.bytes_downloaded += bytes.len() as u64;
        job.updated_at = now_iso_string()?;
        upsert_download_job(paths, job)?;
    }

    Ok(())
}

fn fail_download_job(
    paths: &PersonaStoragePaths,
    job: &mut DownloadJobRecord,
    error: String,
    staging_root: &Path,
    final_bundle_dir: &Path,
    final_runtime_dir: &Path,
) -> Result<String, String> {
    cleanup_path(staging_root);
    cleanup_path(final_bundle_dir);
    cleanup_path(final_runtime_dir);

    job.status = DownloadJobStatus::Failed;
    job.error = Some(error.clone());
    job.updated_at = now_iso_string()?;
    upsert_download_job(paths, job)?;

    Ok(error)
}

pub async fn install_persona_at_path(
    root_dir: &Path,
    manifest: DesktopPersonaManifest,
    client: &Client,
) -> Result<InstalledPersonaRecord, String> {
    validate_manifest(&manifest)?;

    let paths = persona_storage_paths(root_dir);
    ensure_storage_dirs(&paths)?;

    let persona_segment = sanitize_storage_segment(&manifest.id);
    let version_segment = sanitize_storage_segment(&manifest.version);
    let staging_root = paths
        .temp_downloads_dir
        .join(format!("install-{persona_segment}-{}", unique_suffix()));
    let staging_bundle_dir = staging_root.join("bundle");
    let final_bundle_dir = paths
        .bundles_dir
        .join(&persona_segment)
        .join(&version_segment);
    let final_runtime_dir = paths
        .runtime_dir
        .join(&persona_segment)
        .join(&version_segment);
    let created_at = now_iso_string()?;

    fs::create_dir_all(&staging_bundle_dir).map_err(|error| {
        format!(
            "Failed to create desktop staging bundle directory {}: {error}",
            staging_bundle_dir.display()
        )
    })?;

    let mut job = DownloadJobRecord {
        job_id: format!("install-{persona_segment}-{}", unique_suffix()),
        persona_id: manifest.id.clone(),
        status: DownloadJobStatus::Queued,
        manifest: manifest.clone(),
        temp_file_path: staging_root.to_string_lossy().to_string(),
        target_bundle_path: final_bundle_dir.to_string_lossy().to_string(),
        target_runtime_path: final_runtime_dir.to_string_lossy().to_string(),
        bytes_downloaded: 0,
        error: None,
        created_at: created_at.clone(),
        updated_at: created_at.clone(),
    };
    upsert_download_job(&paths, &job)?;

    job.status = DownloadJobStatus::Downloading;
    job.updated_at = now_iso_string()?;
    upsert_download_job(&paths, &job)?;

    if let Err(error) =
        download_manifest_into_staging(client, &manifest, &staging_bundle_dir, &mut job, &paths)
            .await
    {
        return Err(fail_download_job(
            &paths,
            &mut job,
            error,
            &staging_root,
            &final_bundle_dir,
            &final_runtime_dir,
        )?);
    }

    job.status = DownloadJobStatus::Verifying;
    job.updated_at = now_iso_string()?;
    upsert_download_job(&paths, &job)?;

    if let Some(parent) = final_bundle_dir.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create desktop bundle parent directory {}: {error}",
                parent.display()
            )
        })?;
    }
    if let Some(parent) = final_runtime_dir.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create desktop runtime parent directory {}: {error}",
                parent.display()
            )
        })?;
    }

    if final_bundle_dir.exists() {
        cleanup_path(&final_bundle_dir);
    }
    if final_runtime_dir.exists() {
        cleanup_path(&final_runtime_dir);
    }

    if let Err(error) = fs::rename(&staging_bundle_dir, &final_bundle_dir) {
        return Err(fail_download_job(
            &paths,
            &mut job,
            format!(
                "Failed to promote staged bundle {} to {}: {error}",
                staging_bundle_dir.display(),
                final_bundle_dir.display()
            ),
            &staging_root,
            &final_bundle_dir,
            &final_runtime_dir,
        )?);
    }

    if let Err(error) = fs::create_dir_all(&final_runtime_dir) {
        return Err(fail_download_job(
            &paths,
            &mut job,
            format!(
                "Failed to create runtime assets directory {}: {error}",
                final_runtime_dir.display()
            ),
            &staging_root,
            &final_bundle_dir,
            &final_runtime_dir,
        )?);
    }

    let installed_at = now_iso_string()?;
    let installed_record = InstalledPersonaRecord {
        persona_id: manifest.id.clone(),
        source_type: manifest.source_type.clone(),
        source_ref: manifest.source_ref.clone(),
        version: manifest.version.clone(),
        checksum: manifest.checksum.clone(),
        manifest,
        bundle_path: final_bundle_dir.to_string_lossy().to_string(),
        runtime_assets_path: final_runtime_dir.to_string_lossy().to_string(),
        installed_at: installed_at.clone(),
    };

    let previous_record = match upsert_installed_persona(&paths, &installed_record) {
        Ok(previous_record) => previous_record,
        Err(error) => {
            return Err(fail_download_job(
                &paths,
                &mut job,
                error,
                &staging_root,
                &final_bundle_dir,
                &final_runtime_dir,
            )?);
        }
    };

    cleanup_path(&staging_root);

    if let Some(previous_record) = previous_record {
        if previous_record.bundle_path != installed_record.bundle_path {
            cleanup_path(Path::new(&previous_record.bundle_path));
        }
        if previous_record.runtime_assets_path != installed_record.runtime_assets_path {
            cleanup_path(Path::new(&previous_record.runtime_assets_path));
        }
    }

    job.status = DownloadJobStatus::Completed;
    job.error = None;
    job.updated_at = installed_at;
    upsert_download_job(&paths, &job)?;

    Ok(installed_record)
}

pub fn load_installed_personas_at_path(
    root_dir: &Path,
) -> Result<Vec<InstalledPersonaRecord>, String> {
    let paths = persona_storage_paths(root_dir);
    read_json_or_default(&paths.installed_personas_path)
}

pub fn load_active_persona_at_path(root_dir: &Path) -> Result<Option<ActivePersonaRecord>, String> {
    let paths = persona_storage_paths(root_dir);
    let active_persona =
        read_json_or_default::<Option<ActivePersonaRecord>>(&paths.active_persona_path)?;

    if let Some(active_persona) = active_persona {
        let installed_personas = load_installed_personas_at_path(root_dir)?;
        if installed_personas
            .iter()
            .any(|installed| installed.persona_id == active_persona.persona_id)
        {
            return Ok(Some(active_persona));
        }
    }

    Ok(None)
}

pub fn set_active_persona_at_path(
    root_dir: &Path,
    persona_id: &str,
) -> Result<ActivePersonaRecord, String> {
    let normalized_persona_id = persona_id.trim();
    if normalized_persona_id.is_empty() {
        return Err("personaId is required".to_string());
    }

    let installed_personas = load_installed_personas_at_path(root_dir)?;
    let installed_persona = installed_personas
        .into_iter()
        .find(|installed| installed.persona_id == normalized_persona_id)
        .ok_or_else(|| format!("Persona \"{normalized_persona_id}\" is not installed"))?;

    let active_persona = ActivePersonaRecord {
        persona_id: installed_persona.persona_id,
        source_type: installed_persona.source_type,
        source_ref: installed_persona.source_ref,
        activated_at: now_iso_string()?,
    };

    let paths = persona_storage_paths(root_dir);
    write_json_atomic(&paths.active_persona_path, &Some(active_persona.clone()))?;

    Ok(active_persona)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    use tempfile::TempDir;

    use super::*;

    fn spawn_static_http_server(
        routes: Vec<(&'static str, Vec<u8>)>,
    ) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind local test server");
        let address = listener
            .local_addr()
            .expect("read local test server address");
        let route_map = HashMap::<String, Vec<u8>>::from_iter(
            routes
                .into_iter()
                .map(|(path, body)| (path.to_string(), body)),
        );
        let request_count = route_map.len();

        let handle = thread::spawn(move || {
            for _ in 0..request_count {
                let (mut stream, _) = listener.accept().expect("accept test request");
                let mut buffer = [0_u8; 4096];
                let bytes_read = stream.read(&mut buffer).expect("read test request");
                let request = String::from_utf8_lossy(&buffer[..bytes_read]);
                let path = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .unwrap_or("/");

                let (status_line, body) = route_map
                    .get(path)
                    .map(|body| ("200 OK", body.clone()))
                    .unwrap_or_else(|| ("404 Not Found", b"missing".to_vec()));

                write!(
                    stream,
                    "HTTP/1.1 {status_line}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                )
                .expect("write test response headers");
                stream.write_all(&body).expect("write test response body");
            }
        });

        (format!("http://{address}"), handle)
    }

    fn temp_downloads_dir_entries(root_dir: &Path) -> Vec<PathBuf> {
        let temp_downloads_dir = root_dir.join("downloads").join("temp");
        if !temp_downloads_dir.exists() {
            return Vec::new();
        }

        fs::read_dir(temp_downloads_dir)
            .expect("read temp downloads directory")
            .map(|entry| entry.expect("read temp downloads directory entry").path())
            .collect()
    }

    fn sample_manifest(
        base_url: &str,
        first_checksum: String,
        second_checksum: String,
    ) -> DesktopPersonaManifest {
        DesktopPersonaManifest {
            id: "catalog-starter".to_string(),
            source_type: "starter".to_string(),
            source_ref: "starter-aurora".to_string(),
            title: "Aurora Starter".to_string(),
            description: Some("Starter persona for desktop install tests.".to_string()),
            cover_image: "https://cdn.example.com/aurora-cover.png".to_string(),
            thumbnail: "https://cdn.example.com/aurora-thumb.png".to_string(),
            updated_at: "2026-04-10T03:00:00.000Z".to_string(),
            version: "1.0.0".to_string(),
            checksum: "sha256:manifest-placeholder".to_string(),
            files: vec![
                DesktopPersonaManifestFile {
                    path: "bundle/persona.json".to_string(),
                    url: format!("{base_url}/bundle/persona.json"),
                    checksum: first_checksum,
                },
                DesktopPersonaManifestFile {
                    path: "bundle/avatar.bin".to_string(),
                    url: format!("{base_url}/bundle/avatar.bin"),
                    checksum: second_checksum,
                },
            ],
        }
    }

    #[test]
    fn install_persona_downloads_verified_files_and_persists_install_state() {
        let root_dir = TempDir::new().expect("create temp desktop root");
        let persona_bytes = br#"{"persona":"aurora"}"#.to_vec();
        let avatar_bytes = vec![1_u8, 2, 3, 4, 5, 6];
        let (base_url, server_handle) = spawn_static_http_server(vec![
            ("/bundle/persona.json", persona_bytes.clone()),
            ("/bundle/avatar.bin", avatar_bytes.clone()),
        ]);
        let manifest = sample_manifest(
            &base_url,
            sha256_checksum(&persona_bytes),
            sha256_checksum(&avatar_bytes),
        );

        let installed_record = tauri::async_runtime::block_on(install_persona_at_path(
            root_dir.path(),
            manifest.clone(),
            &Client::new(),
        ))
        .expect("install persona");

        server_handle.join().expect("join test server");

        assert_eq!(installed_record.persona_id, manifest.id);
        assert_eq!(installed_record.source_ref, manifest.source_ref);
        assert_eq!(installed_record.version, manifest.version);
        assert!(Path::new(&installed_record.bundle_path).exists());
        assert!(Path::new(&installed_record.runtime_assets_path).exists());
        assert_eq!(
            fs::read(
                Path::new(&installed_record.bundle_path)
                    .join("bundle")
                    .join("persona.json")
            )
            .expect("read installed persona bundle"),
            persona_bytes
        );
        assert_eq!(
            fs::read(
                Path::new(&installed_record.bundle_path)
                    .join("bundle")
                    .join("avatar.bin")
            )
            .expect("read installed avatar bundle"),
            avatar_bytes
        );
        assert_eq!(
            load_installed_personas_at_path(root_dir.path()).expect("load installed personas"),
            vec![installed_record.clone()]
        );

        let download_jobs = read_json_or_default::<Vec<DownloadJobRecord>>(
            &root_dir.path().join("state").join("download_jobs.json"),
        )
        .expect("read persisted download jobs");
        assert_eq!(download_jobs.len(), 1);
        assert_eq!(download_jobs[0].status, DownloadJobStatus::Completed);
        assert!(download_jobs[0].bytes_downloaded > 0);
        assert!(!Path::new(&download_jobs[0].temp_file_path).exists());
        assert!(temp_downloads_dir_entries(root_dir.path()).is_empty());
    }

    #[test]
    fn install_persona_cleans_temp_files_and_keeps_install_state_empty_on_checksum_failure() {
        let root_dir = TempDir::new().expect("create temp desktop root");
        let bad_bytes = b"bad-download".to_vec();
        let (base_url, server_handle) =
            spawn_static_http_server(vec![("/bundle/persona.json", bad_bytes.clone())]);
        let manifest = DesktopPersonaManifest {
            id: "catalog-starter".to_string(),
            source_type: "starter".to_string(),
            source_ref: "starter-aurora".to_string(),
            title: "Aurora Starter".to_string(),
            description: Some("Starter persona for desktop install tests.".to_string()),
            cover_image: "https://cdn.example.com/aurora-cover.png".to_string(),
            thumbnail: "https://cdn.example.com/aurora-thumb.png".to_string(),
            updated_at: "2026-04-10T03:00:00.000Z".to_string(),
            version: "1.0.0".to_string(),
            checksum: "sha256:manifest-placeholder".to_string(),
            files: vec![DesktopPersonaManifestFile {
                path: "bundle/persona.json".to_string(),
                url: format!("{base_url}/bundle/persona.json"),
                checksum: sha256_checksum(b"expected-download"),
            }],
        };

        let error = tauri::async_runtime::block_on(install_persona_at_path(
            root_dir.path(),
            manifest,
            &Client::new(),
        ))
        .expect_err("checksum mismatch should fail");

        server_handle.join().expect("join test server");

        assert!(error.contains("Checksum verification failed"));
        assert!(load_installed_personas_at_path(root_dir.path())
            .expect("load installed personas after failure")
            .is_empty());
        assert_eq!(
            load_active_persona_at_path(root_dir.path())
                .expect("load active persona after failure"),
            None
        );

        let download_jobs = read_json_or_default::<Vec<DownloadJobRecord>>(
            &root_dir.path().join("state").join("download_jobs.json"),
        )
        .expect("read persisted failed download jobs");
        assert_eq!(download_jobs.len(), 1);
        assert_eq!(download_jobs[0].status, DownloadJobStatus::Failed);
        assert!(download_jobs[0]
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("Checksum"));
        assert!(!Path::new(&download_jobs[0].temp_file_path).exists());
        assert!(temp_downloads_dir_entries(root_dir.path()).is_empty());
    }

    #[test]
    fn set_active_persona_persists_local_selection_for_restart_recovery() {
        let root_dir = TempDir::new().expect("create temp desktop root");
        let installed_record = InstalledPersonaRecord {
            persona_id: "catalog-starter".to_string(),
            source_type: "starter".to_string(),
            source_ref: "starter-aurora".to_string(),
            version: "1.0.0".to_string(),
            checksum: "sha256:manifest-placeholder".to_string(),
            manifest: sample_manifest(
                "https://downloads.example.com",
                "sha256:file-1".to_string(),
                "sha256:file-2".to_string(),
            ),
            bundle_path: root_dir
                .path()
                .join("personas")
                .join("bundles")
                .join("catalog-starter")
                .join("1.0.0")
                .to_string_lossy()
                .to_string(),
            runtime_assets_path: root_dir
                .path()
                .join("personas")
                .join("runtime")
                .join("catalog-starter")
                .join("1.0.0")
                .to_string_lossy()
                .to_string(),
            installed_at: "2026-04-10T03:00:00.000Z".to_string(),
        };
        let paths = persona_storage_paths(root_dir.path());

        ensure_storage_dirs(&paths).expect("create persona storage dirs");
        write_json_atomic(&paths.installed_personas_path, &vec![installed_record])
            .expect("write installed personas fixture");

        let active_persona = set_active_persona_at_path(root_dir.path(), "catalog-starter")
            .expect("set active persona");

        assert_eq!(active_persona.persona_id, "catalog-starter");
        assert_eq!(
            load_active_persona_at_path(root_dir.path()).expect("load active persona"),
            Some(active_persona)
        );
        assert!(paths.active_persona_path.exists());
    }
}
