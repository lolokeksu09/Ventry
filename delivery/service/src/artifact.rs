use axum::body::Bytes;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{error::Error, fs, path::Path, process::Command};

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Release {
    pub product: String,
    pub tag: String,
    pub version_name: String,
    pub version_code: i64,
    pub package_name: String,
    pub revision: String,
    pub size: usize,
    pub sha256: String,
    pub certificate_sha256: String,
    pub source: String,
    pub prerelease: bool,
}

#[derive(Clone)]
pub struct Artifact {
    pub release: Release,
    pub bytes: Bytes,
}

fn is_hex(s: &str, len: usize) -> bool {
    s.len() == len && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn command_output(tool: &Path, args: &[&str]) -> Result<String, Box<dyn Error>> {
    let output = Command::new(tool).args(args).output()?;
    if !output.status.success() {
        return Err("Android artifact verification command failed".into());
    }
    Ok(String::from_utf8(output.stdout)?)
}

pub fn load(apk: &Path, apksigner: &Path, aapt: &Path) -> Result<Artifact, Box<dyn Error>> {
    let release: Release = serde_json::from_str(include_str!("../release.json"))?;
    if release.product != "raschet" || release.package_name != "dev.ventry.raschet"
        || !is_hex(&release.sha256, 64) || !is_hex(&release.certificate_sha256, 64)
        || !is_hex(&release.revision, 40) || release.size == 0 || release.size > 64 * 1024 * 1024
        || fs::metadata(apk)?.len() != release.size as u64
    {
        return Err("Invalid approved release metadata or APK size".into());
    }
    let bytes = fs::read(apk)?;
    if bytes.len() != release.size || hex::encode(Sha256::digest(&bytes)) != release.sha256 {
        return Err("APK digest mismatch".into());
    }
    let path = apk.to_str().ok_or("Non-UTF8 APK path")?;
    let certs = command_output(apksigner, &["verify", "--min-sdk-version", "26", "--verbose", "--print-certs", path])?;
    let certificates: Vec<_> = certs.lines().filter_map(|line| {
        let (prefix, digest) = line.split_once(" certificate SHA-256 digest: ")?;
        if prefix.starts_with("Signer #") && !prefix.contains("lineage") {
            Some(digest.trim().to_ascii_lowercase())
        } else { None }
    }).collect();
    if certificates.len() != 1 || certificates[0] != release.certificate_sha256 {
        return Err("APK certificate mismatch or unexpected signer count".into());
    }
    let badging = command_output(aapt, &["dump", "badging", path])?;
    let package = badging.lines().find(|line| line.starts_with("package: ")).ok_or("Missing APK package metadata")?;
    for expected in [format!("name='{}'", release.package_name),
                     format!("versionCode='{}'", release.version_code),
                     format!("versionName='{}'", release.version_name)] {
        if !package.split_whitespace().any(|field| field == expected) {
            return Err("APK package/version mismatch".into());
        }
    }
    if hex::encode(Sha256::digest(fs::read(apk)?)) != release.sha256 {
        return Err("APK changed during verification".into());
    }
    Ok(Artifact { release, bytes: Bytes::from(bytes) })
}
