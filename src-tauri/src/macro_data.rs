use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub x: i32,
    pub y: i32,
    #[serde(default)]
    pub fields: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Connection {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacroData {
    pub nodes: Vec<Node>,
    pub connections: Vec<Connection>,
}
