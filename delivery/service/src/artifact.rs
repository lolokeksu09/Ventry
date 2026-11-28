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
    verify(apk, apksigner, aapt, release)
}

/// Operator-selected local immutable bundle. The embedded release remains the
/// compatibility default and the independent trust anchor for the APK signer.
/// The expected hash must come from the operator, not from the bundle itself.
pub fn load_bundle(dir: &Path, expected: &str, apksigner: &Path, aapt: &Path) -> Result<Artifact, Box<dyn Error>> {
    if !dir.is_absolute() || !is_hex(expected, 64) {
        return Err("Invalid release bundle selection".into());
    }
    let manifest = dir.join("release.json");
    let apk = dir.join("Raschet.apk");
    for path in [&manifest, &apk] {
        if !fs::symlink_metadata(path)?.file_type().is_file() {
            return Err("Release bundle members must be regular files".into());
        }
    }
    if fs::metadata(&manifest)?.len() > 8192 {
        return Err("Release manifest too large".into());
    }
    let release: Release = serde_json::from_slice(&fs::read(&manifest)?)?;
    let anchor: Release = serde_json::from_str(include_str!("../release.json"))?;
    validate_selection(&release, &anchor, expected)?;
    verify(&apk, apksigner, aapt, release)
}

fn validate_selection(release: &Release, anchor: &Release, expected: &str) -> Result<(), Box<dyn Error>> {
    if !is_hex(expected, 64) || release.sha256 != expected
        || release.certificate_sha256 != anchor.certificate_sha256
        || release.product != anchor.product || release.package_name != anchor.package_name
        || release.version_code < anchor.version_code
        || (release.version_code == anchor.version_code && release.sha256 != anchor.sha256)
        || release.version_name.is_empty() || release.version_name.len() > 128
    {
        return Err("Release bundle does not match approved identity".into());
    }
    Ok(())
}

fn verify(apk: &Path, apksigner: &Path, aapt: &Path, release: Release) -> Result<Artifact, Box<dyn Error>> {
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

#[cfg(test)]
mod selection_tests {
    use super::*;
    fn baseline() -> Release { serde_json::from_str(include_str!("../release.json")).unwrap() }

    #[test]
    fn explicit_selection_pins_hash_signer_and_package() {
        let base = baseline();
        let mut next = base.clone();
        next.version_code += 1;
        next.sha256 = "1".repeat(64);
        assert!(validate_selection(&next, &base, &next.sha256).is_ok());
        assert!(validate_selection(&next, &base, &base.sha256).is_err());
        next.certificate_sha256 = "2".repeat(64);
        assert!(validate_selection(&next, &base, &next.sha256).is_err());
        next.certificate_sha256 = base.certificate_sha256.clone();
        next.package_name = "other.package".into();
        assert!(validate_selection(&next, &base, &next.sha256).is_err());
    }

    #[test]
    fn baseline_can_be_restored_but_version_reuse_and_older_versions_are_rejected() {
        let base = baseline();
        assert!(validate_selection(&base, &base, &base.sha256).is_ok());
        let mut other = base.clone();
        other.sha256 = "1".repeat(64);
        assert!(validate_selection(&other, &base, &other.sha256).is_err());
        other.version_code -= 1;
        assert!(validate_selection(&other, &base, &other.sha256).is_err());
    }
}
