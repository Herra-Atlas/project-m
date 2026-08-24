use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter, Manager};

const KILO_BASE: &str = "https://api.kilo.ai/api/gateway";

/// Frontend-published chunk schema. Mirrors the OpenAI streaming shape
/// (`chat.completion.chunk`) so the React side can stay model-agnostic.
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AiChunk {
    /// Plain text delta for the assistant message body.
    Content { delta: String },
    /// Reasoning/thinking delta — collapsed by default in the UI.
    Reasoning { delta: String },
    /// Tool/function call lifecycle.
    ToolStart { id: String, name: String, args: String },
    ToolDelta { id: String, args_delta: String },
    ToolEnd { id: String },
    /// Conversation lifecycle.
    Begin { model: String },
    Done { model: String, finish_reason: Option<String> },
    Error { message: String },
}

/// One message in a chat conversation. Frontend serializes the whole
/// transcript on every send, Rust forwards verbatim to the gateway.
#[derive(Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default, rename = "reasoning_content")]
    pub reasoning_content: Option<String>,
    #[serde(default, rename = "tool_calls")]
    pub tool_calls: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    pub tool_call_id: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub api_key: String,
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub system: Option<String>,
    #[serde(default)]
    pub stream_id: Option<String>,
}

/// Fetch the model catalog the user can pick from. Kilo's gateway exposes
/// this as an OpenAI-compatible `GET /models` endpoint — no auth required.
#[tauri::command]
pub async fn kilo_list_models() -> Result<Vec<serde_json::Value>, String> {
    let url = format!("{}/models", KILO_BASE);
    let resp = reqwest::Client::new()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to reach Kilo /models: {}", e))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Kilo /models returned {}: {}", status, body));
    }
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse /models JSON: {}", e))?;
    let data = json
        .get("data")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Kilo /models response missing `data` array".to_string())?;
    Ok(data.clone())
}

/// Probe the user's API key with a 1-token chat request. Used by the
/// Settings → AI → Test button. Costs effectively nothing.
#[tauri::command]
pub async fn kilo_test_api_key(req: ChatRequest) -> Result<(), String> {
    let url = format!("{}/chat/completions", KILO_BASE);
    let body = serde_json::json!({
        "model": req.model,
        "messages": [
            { "role": "user", "content": "ping" }
        ],
        "max_tokens": 1,
    });
    let resp = reqwest::Client::new()
        .post(&url)
        .bearer_auth(&req.api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to reach Kilo /chat/completions: {}", e))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Kilo returned {}: {}", status, body));
    }
    Ok(())
}

/// Stream a chat completion to the frontend. Each SSE event is forwarded
/// verbatim as an `ai-chunk` event keyed by the supplied `stream_id` so
/// multiple concurrent streams (rare, but possible during retries) don't
/// stomp each other.
#[tauri::command]
pub async fn kilo_chat_stream(app: AppHandle, req: ChatRequest) -> Result<(), String> {
    let stream_id = req
        .stream_id
        .unwrap_or_else(|| format!("stream-{}", next_stream_id()));
    let event_name = format!("ai-chunk:{}", stream_id);

    let url = format!("{}/chat/completions", KILO_BASE);
    let mut messages: Vec<serde_json::Value> = Vec::with_capacity(req.messages.len() + 1);
    if let Some(sys) = req.system.as_deref().filter(|s| !s.is_empty()) {
        messages.push(serde_json::json!({ "role": "system", "content": sys }));
    }
    for m in req.messages.iter() {
        let mut obj = serde_json::json!({ "role": m.role });
        if let Some(c) = &m.content {
            obj["content"] = serde_json::Value::String(c.clone());
        }
        if let Some(r) = &m.reasoning_content {
            obj["reasoning_content"] = serde_json::Value::String(r.clone());
        }
        if let Some(tc) = &m.tool_calls {
            obj["tool_calls"] = serde_json::to_value(tc).unwrap_or_default();
        }
        if let Some(tcid) = &m.tool_call_id {
            obj["tool_call_id"] = serde_json::Value::String(tcid.clone());
        }
        messages.push(obj);
    }

    let body = serde_json::json!({
        "model": req.model,
        "messages": messages,
        "stream": true,
        // Ask providers that support it (DeepSeek, Qwen, etc.) for a
        // separate reasoning stream so the UI can collapse it cleanly.
        "reasoning": { "effort": "medium" },
    });

    let resp = reqwest::Client::new()
        .post(&url)
        .bearer_auth(&req.api_key)
        .header("Content-Type", "application/json")
        .header("Accept", "text/event-stream")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to reach Kilo /chat/completions: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let _ = app.emit(
            &event_name,
            AiChunk::Error {
                message: format!("Kilo returned {}: {}", status, body),
            },
        );
        return Ok(());
    }

    let _ = app.emit(&event_name, AiChunk::Begin { model: req.model.clone() });

    // State for assembling tool_calls across the stream. Keyed by index.
    let mut tool_args: std::collections::HashMap<usize, String> = std::collections::HashMap::new();
    let mut tool_ids: std::collections::HashMap<usize, String> = std::collections::HashMap::new();
    let mut tool_names: std::collections::HashMap<usize, String> = std::collections::HashMap::new();

    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();

    while let Some(item) = stream.next().await {
        let chunk = match item {
            Ok(c) => c,
            Err(e) => {
                let _ = app.emit(
                    &event_name,
                    AiChunk::Error {
                        message: format!("Stream error: {}", e),
                    },
                );
                return Ok(());
            }
        };
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        // SSE messages are separated by a blank line. We split on \n\n
        // boundary and emit parsed events as we go.
        while let Some(idx) = buffer.find("\n\n") {
            let event_block: String = buffer.drain(..idx + 2).collect();
            for line in event_block.lines() {
                let line = line.trim_end_matches('\r');
                let Some(payload) = line.strip_prefix("data:") else {
                    continue;
                };
                let payload = payload.trim_start();
                if payload.is_empty() {
                    continue;
                }
                if payload == "[DONE]" {
                    let _ = app.emit(
                        &event_name,
                        AiChunk::Done {
                            model: req.model.clone(),
                            finish_reason: Some("stop".to_string()),
                        },
                    );
                    continue;
                }
                let parsed: serde_json::Value = match serde_json::from_str(payload) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                process_chunk(&app, &event_name, &parsed, &mut tool_ids, &mut tool_names, &mut tool_args);
            }
        }
    }

    // Close any tool calls that were started but never received an end marker.
    for (idx, id) in tool_ids.iter() {
        if !id.is_empty() {
            let _ = app.emit(&event_name, AiChunk::ToolEnd { id: id.clone() });
        }
        let _ = idx;
    }

    Ok(())
}

fn process_chunk(
    app: &AppHandle,
    event_name: &str,
    parsed: &serde_json::Value,
    tool_ids: &mut std::collections::HashMap<usize, String>,
    tool_names: &mut std::collections::HashMap<usize, String>,
    tool_args: &mut std::collections::HashMap<usize, String>,
) {
    let Some(choice) = parsed.get("choices").and_then(|c| c.as_array()).and_then(|a| a.first()) else {
        return;
    };
    let Some(delta) = choice.get("delta") else {
        return;
    };

    if let Some(reasoning) = delta.get("reasoning_content").and_then(|v| v.as_str()) {
        if !reasoning.is_empty() {
            let _ = app.emit(event_name, AiChunk::Reasoning { delta: reasoning.to_string() });
        }
    }

    if let Some(content) = delta.get("content").and_then(|v| v.as_str()) {
        if !content.is_empty() {
            let _ = app.emit(event_name, AiChunk::Content { delta: content.to_string() });
        }
    }

    if let Some(calls) = delta.get("tool_calls").and_then(|v| v.as_array()) {
        for tc in calls {
            let idx = tc.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
            if let Some(id) = tc.get("id").and_then(|v| v.as_str()) {
                if !id.is_empty() {
                    tool_ids.insert(idx, id.to_string());
                    let name = tc
                        .get("function")
                        .and_then(|f| f.get("name"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    tool_names.insert(idx, name.clone());
                    tool_args.insert(idx, String::new());
                    let _ = app.emit(
                        event_name,
                        AiChunk::ToolStart {
                            id: id.to_string(),
                            name,
                            args: String::new(),
                        },
                    );
                }
            }
            if let Some(args_delta) =
                tc.get("function").and_then(|f| f.get("arguments")).and_then(|v| v.as_str())
            {
                if !args_delta.is_empty() {
                    let entry = tool_args.entry(idx).or_default();
                    entry.push_str(args_delta);
                    let id = tool_ids.get(&idx).cloned().unwrap_or_default();
                    if !id.is_empty() {
                        let _ = app.emit(
                            event_name,
                            AiChunk::ToolDelta {
                                id,
                                args_delta: args_delta.to_string(),
                            },
                        );
                    }
                }
            }
        }
    }
}

static STREAM_COUNTER: AtomicU64 = AtomicU64::new(1);
fn next_stream_id() -> u64 {
    STREAM_COUNTER.fetch_add(1, Ordering::Relaxed)
}

/// Make sure the manager still recognizes `AppHandle` as in use; this silences
/// `unused_imports` if the file is read in isolation.
#[allow(dead_code)]
fn _unused_marker(_: &AppHandle) {}

/// Read the Kilo API key from settings.json. Returns `Ok(None)` if the
/// file is missing or has no `kiloApiKey` field, so the frontend can prompt
/// the user without surfacing an error.
#[tauri::command]
pub fn kilo_get_api_key(app: AppHandle) -> Result<Option<String>, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = data_dir.join("settings.json");
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs_err(&path)?;
    let parsed: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| format!("settings.json is not valid JSON: {}", e))?;
    Ok(parsed
        .get("kiloApiKey")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string()))
}

fn fs_err(path: &std::path::Path) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| format!("Failed to read {}: {}", path.display(), e))
}