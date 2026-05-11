use axum::http::HeaderMap;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::Sha256;
use subtle::ConstantTimeEq;

use crate::error::ApiError;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenPurpose {
    Publish,
    Subscribe,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Claims {
    pub aud: String,
    pub exp: u64,
    pub purpose: String,
    #[serde(rename = "roomId")]
    pub room_id: String,
}

pub fn verify_bearer(
    headers: &HeaderMap,
    secret: &str,
    expected_purpose: TokenPurpose,
    expected_room_id: &str,
) -> Result<Claims, ApiError> {
    let token = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or_else(|| ApiError::unauthorized("missing bearer token"))?;

    verify_token(token, secret, expected_purpose, expected_room_id)
}

pub fn verify_token(
    token: &str,
    secret: &str,
    expected_purpose: TokenPurpose,
    expected_room_id: &str,
) -> Result<Claims, ApiError> {
    let mut parts = token.split('.');
    let header = parts
        .next()
        .ok_or_else(|| ApiError::unauthorized("malformed token"))?;
    let claims = parts
        .next()
        .ok_or_else(|| ApiError::unauthorized("malformed token"))?;
    let signature = parts
        .next()
        .ok_or_else(|| ApiError::unauthorized("malformed token"))?;

    if parts.next().is_some() {
        return Err(ApiError::unauthorized("malformed token"));
    }

    let signing_input = format!("{header}.{claims}");
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|_| ApiError::internal("invalid token secret"))?;
    mac.update(signing_input.as_bytes());
    let expected = mac.finalize().into_bytes();
    let provided = URL_SAFE_NO_PAD
        .decode(signature)
        .map_err(|_| ApiError::unauthorized("invalid token signature encoding"))?;

    if expected.as_slice().ct_eq(provided.as_slice()).unwrap_u8() != 1 {
        return Err(ApiError::unauthorized("invalid token signature"));
    }

    let claims_bytes = URL_SAFE_NO_PAD
        .decode(claims)
        .map_err(|_| ApiError::unauthorized("invalid token claims encoding"))?;
    let claims: Claims = serde_json::from_slice(&claims_bytes)
        .map_err(|_| ApiError::unauthorized("invalid token claims"))?;

    if claims.aud != "helena-media" {
        return Err(ApiError::unauthorized("invalid token audience"));
    }
    if claims.room_id != expected_room_id {
        return Err(ApiError::unauthorized("token room does not match request"));
    }
    if claims.purpose != expected_purpose.as_str() {
        return Err(ApiError::unauthorized(
            "token purpose does not match request",
        ));
    }
    if claims.exp <= unix_now() {
        return Err(ApiError::unauthorized("token expired"));
    }

    Ok(claims)
}

impl TokenPurpose {
    fn as_str(self) -> &'static str {
        match self {
            Self::Publish => "publish",
            Self::Subscribe => "subscribe",
        }
    }
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
    use hmac::{Hmac, Mac};
    use serde_json::json;
    use sha2::Sha256;

    fn test_token(secret: &str, room_id: &str, purpose: &str, exp: u64) -> String {
        let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"HS256","typ":"JWT"}"#);
        let claims = URL_SAFE_NO_PAD.encode(
            json!({
                "aud": "helena-media",
                "exp": exp,
                "iat": 1,
                "jti": "test",
                "purpose": purpose,
                "roomId": room_id
            })
            .to_string(),
        );
        let signing_input = format!("{header}.{claims}");
        let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("hmac secret");
        mac.update(signing_input.as_bytes());
        let signature = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());

        format!("{signing_input}.{signature}")
    }

    #[test]
    fn verifies_matching_tokens() {
        let token = test_token("secret", "lobby", "publish", u64::MAX);
        let claims =
            verify_token(&token, "secret", TokenPurpose::Publish, "lobby").expect("valid token");

        assert_eq!(claims.room_id, "lobby");
    }

    #[test]
    fn rejects_wrong_room() {
        let token = test_token("secret", "lobby", "publish", u64::MAX);
        let error =
            verify_token(&token, "secret", TokenPurpose::Publish, "other").expect_err("wrong room");

        assert_eq!(error.status(), axum::http::StatusCode::UNAUTHORIZED);
    }
}
