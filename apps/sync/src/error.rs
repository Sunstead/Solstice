//! API errors: `{ code, message }` JSON with a matching status, as in Atlas
//! and Cosmos. The code is what clients act on.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;

#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    BadRequest,
    /// No or bad credentials: sign in again.
    Unauthorized,
    Forbidden,
    NotFound,
    Conflict,
    /// Configured but failing right now (the identity provider): retry.
    Unavailable,
    Internal,
}

#[derive(Serialize, Debug)]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn not_found() -> Self {
        Self::new(ErrorCode::NotFound, "Not found")
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::BadRequest, message)
    }

    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Unauthorized, message)
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Forbidden, message)
    }

    /// Logs the detail (it can name paths) and tells the client only that it
    /// went wrong.
    pub fn internal(detail: impl std::fmt::Display) -> Self {
        tracing::error!(error = %detail, "internal error");
        Self::new(ErrorCode::Internal, "Something went wrong on the server")
    }

    fn status(&self) -> StatusCode {
        match self.code {
            ErrorCode::BadRequest => StatusCode::BAD_REQUEST,
            ErrorCode::Unauthorized => StatusCode::UNAUTHORIZED,
            ErrorCode::Forbidden => StatusCode::FORBIDDEN,
            ErrorCode::NotFound => StatusCode::NOT_FOUND,
            ErrorCode::Conflict => StatusCode::CONFLICT,
            ErrorCode::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
            ErrorCode::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (self.status(), Json(self)).into_response()
    }
}

impl From<crate::db::DbError> for AppError {
    fn from(e: crate::db::DbError) -> Self {
        match e {
            crate::db::DbError::NotFound => Self::not_found(),
            crate::db::DbError::Conflict(m) => Self::new(ErrorCode::Conflict, m),
            e => Self::internal(e),
        }
    }
}

impl From<solstice_sync::Error> for AppError {
    fn from(e: solstice_sync::Error) -> Self {
        match e {
            solstice_sync::Error::Path(_) | solstice_sync::Error::Hidden(_) => {
                Self::bad_request(e.to_string())
            }
            solstice_sync::Error::UnknownFile(_) => Self::not_found(),
            e => Self::internal(e),
        }
    }
}
