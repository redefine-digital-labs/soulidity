// soulidity-opencode-plugin
// version: v1

import { connect } from "node:net";
import { getuid } from "node:process";

const SOCKET = `/tmp/soulidity-${getuid()}.sock`;

function sendToSocket(payload, waitForReply = false, timeoutMs = 300000) {
  return new Promise((resolve) => {
    let settled = false;
    let response = "";

    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    try {
      const socket = connect({ path: SOCKET }, () => {
        socket.write(JSON.stringify(payload));
        socket.end();
        if (!waitForReply) finish(true);
      });

      socket.setEncoding("utf8");
      socket.setTimeout(timeoutMs, () => {
        socket.destroy();
        finish(waitForReply ? null : false);
      });
      socket.on("data", (chunk) => {
        response += chunk;
      });
      socket.on("end", () => {
        if (!waitForReply) return;
        try {
          finish(response ? JSON.parse(response) : null);
        } catch {
          finish(null);
        }
      });
      socket.on("error", () => finish(waitForReply ? null : false));
    } catch {
      finish(waitForReply ? null : false);
    }
  });
}

export default {
  id: "soulidity",
  server: async ({ client, serverUrl }) => {
    const pid = process.pid;
    const serverPort = serverUrl ? parseInt(serverUrl.port, 10) || 4096 : 4096;
    const msgRoles = new Map();
    const sessionState = new Map();
    const sessionCwd = new Map();
    const pendingRequestSessions = new Set();
    const heyApi = client?._client;

    const ENV_KEYS = [
      "TERM_PROGRAM",
      "ITERM_SESSION_ID",
      "TERM_SESSION_ID",
      "TMUX",
      "TMUX_PANE",
      "KITTY_WINDOW_ID",
      "__CFBundleIdentifier",
      "SOULIDITY_TASK_ID",
    ];

    function collectEnv() {
      const env = {};
      for (const key of ENV_KEYS) {
        if (process.env[key]) env[key] = process.env[key];
      }
      return env;
    }

    function getSession(id) {
      if (!sessionState.has(id)) {
        sessionState.set(id, { lastUserText: "", lastAssistantText: "" });
      }
      return sessionState.get(id);
    }

    function base(sessionId, extra = {}) {
      return {
        session_id: sessionId,
        _source: "opencode",
        _ppid: pid,
        _server_port: serverPort,
        _env: collectEnv(),
        _soulidity_task_id: process.env.SOULIDITY_TASK_ID,
        ...extra,
      };
    }

    function capitalizeTool(name) {
      if (!name) return "";
      return name.charAt(0).toUpperCase() + name.slice(1);
    }

    function mapEvent(event) {
      const type = event.type;
      const props = event.properties || {};

      if (type === "session.created" && props.info) {
        const cwd = props.info.directory || "";
        sessionCwd.set(props.info.id, cwd);
        return base(`opencode-${props.info.id}`, { hook_event_name: "SessionStart", cwd });
      }

      if (type === "session.deleted" && props.info) {
        sessionState.delete(props.info.id);
        sessionCwd.delete(props.info.id);
        return base(`opencode-${props.info.id}`, { hook_event_name: "SessionEnd" });
      }

      if (type === "session.updated" && props.info) {
        if (props.info.directory) sessionCwd.set(props.info.id, props.info.directory);
        if (props.info.time?.archived) {
          sessionState.delete(props.info.id);
          sessionCwd.delete(props.info.id);
          return base(`opencode-${props.info.id}`, { hook_event_name: "SessionEnd" });
        }
        if (props.info.title && !props.info.title.startsWith("New session")) {
          return base(`opencode-${props.info.id}`, {
            hook_event_name: "Notification",
            message: props.info.title,
          });
        }
        return null;
      }

      if (type === "session.status" && props.sessionID) {
        const state = getSession(props.sessionID);
        if (props.status?.type === "idle") {
          return base(`opencode-${props.sessionID}`, {
            hook_event_name: "Stop",
            cwd: sessionCwd.get(props.sessionID),
            last_assistant_message: state.lastAssistantText || undefined,
          });
        }
        return null;
      }

      if (type === "message.updated" && props.info?.id && props.info?.sessionID) {
        msgRoles.set(props.info.id, { role: props.info.role, sessionID: props.info.sessionID });
        if (msgRoles.size > 200) {
          msgRoles.delete(msgRoles.keys().next().value);
        }
        return null;
      }

      if (type === "message.part.updated" && props.part?.type === "text" && props.part?.messageID) {
        const meta = msgRoles.get(props.part.messageID);
        if (!meta) return null;
        const state = getSession(meta.sessionID);
        const text = props.part.text || "";
        if (meta.role === "user" && text) {
          state.lastUserText = text;
          return base(`opencode-${meta.sessionID}`, {
            hook_event_name: "UserPromptSubmit",
            cwd: sessionCwd.get(meta.sessionID),
            prompt: text,
          });
        }
        if (meta.role === "assistant" && text) {
          state.lastAssistantText = text;
        }
        return null;
      }

      if (type === "message.part.updated" && props.part?.type === "tool" && props.part?.sessionID) {
        const toolName = capitalizeTool(props.part.tool || "");
        const status = props.part.state?.status;
        const sid = `opencode-${props.part.sessionID}`;
        if (status === "running" || status === "pending") {
          return base(sid, {
            hook_event_name: "PreToolUse",
            cwd: sessionCwd.get(props.part.sessionID),
            tool_name: toolName,
            tool_input: props.part.state?.input || {},
          });
        }
        if (status === "completed" || status === "error") {
          return base(sid, {
            hook_event_name: "PostToolUse",
            cwd: sessionCwd.get(props.part.sessionID),
            tool_name: toolName,
          });
        }
      }

      if (type === "permission.asked" && props.id && props.sessionID) {
        const permission = props.permission || "";
        const patterns = props.patterns || [];
        const toolInput = { patterns, metadata: props.metadata };
        if (permission === "bash" && patterns.length > 0) {
          toolInput.command = patterns.join(" && ");
        }
        if ((permission === "edit" || permission === "write") && patterns.length > 0) {
          toolInput.file_path = patterns[0];
        }
        return base(`opencode-${props.sessionID}`, {
          hook_event_name: "PermissionRequest",
          cwd: sessionCwd.get(props.sessionID),
          tool_name: capitalizeTool(permission),
          tool_input: toolInput,
          _opencode_request_id: props.id,
        });
      }

      if (type === "permission.replied" && props.sessionID) {
        return base(`opencode-${props.sessionID}`, {
          hook_event_name: "PostToolUse",
          cwd: sessionCwd.get(props.sessionID),
        });
      }

      if (type === "question.asked" && props.id && props.sessionID) {
        const questions = (props.questions || []).map((question) => ({
          question: question.question || "",
          header: question.header || "",
          options: (question.options || []).map((option) => ({
            label: option.label,
            description: option.description,
          })),
          multiSelect: question.multiple || false,
        }));
        return base(`opencode-${props.sessionID}`, {
          hook_event_name: "PermissionRequest",
          cwd: sessionCwd.get(props.sessionID),
          tool_name: "AskUserQuestion",
          tool_input: { questions },
          _opencode_request_id: props.id,
        });
      }

      if ((type === "question.replied" || type === "question.rejected") && props.sessionID) {
        return base(`opencode-${props.sessionID}`, {
          hook_event_name: "PostToolUse",
          cwd: sessionCwd.get(props.sessionID),
        });
      }

      return null;
    }

    async function replyPermission(requestId, reply, message) {
      try {
        if (typeof heyApi?.request === "function") {
          await heyApi.request({
            method: "POST",
            url: "/permission/{requestID}/reply",
            path: { requestID: requestId },
            body: { reply, message },
          });
          return;
        }
      } catch {}

      try {
        await fetch(`http://localhost:${serverPort}/permission/${requestId}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reply, message }),
        });
      } catch {}
    }

    async function replyQuestion(requestId, answers) {
      try {
        if (typeof heyApi?.request === "function") {
          await heyApi.request({
            method: "POST",
            url: "/question/{requestID}/reply",
            path: { requestID: requestId },
            body: { answers },
          });
          return;
        }
      } catch {}

      try {
        await fetch(`http://localhost:${serverPort}/question/${requestId}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers }),
        });
      } catch {}
    }

    async function rejectQuestion(requestId) {
      try {
        if (typeof heyApi?.request === "function") {
          await heyApi.request({
            method: "POST",
            url: "/question/{requestID}/reject",
            path: { requestID: requestId },
          });
          return;
        }
      } catch {}

      try {
        await fetch(`http://localhost:${serverPort}/question/${requestId}/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
      } catch {}
    }

    async function handlePermissionRequest(mapped) {
      pendingRequestSessions.add(mapped.session_id);
      let response = null;
      try {
        response = await sendToSocket(mapped, true);
      } finally {
        pendingRequestSessions.delete(mapped.session_id);
      }
      if (!response) return;
      const decision = response?.hookSpecificOutput?.decision;
      if (!decision?.behavior) return;
      const hasUpdatedPermissions = decision.updatedPermissions != null;
      const reply = decision.behavior === "allow" && hasUpdatedPermissions
        ? "always"
        : decision.behavior === "allow"
          ? "once"
          : "reject";
      await replyPermission(mapped._opencode_request_id, reply, decision.reason);
    }

    async function handleQuestionRequest(mapped) {
      pendingRequestSessions.add(mapped.session_id);
      let response = null;
      try {
        response = await sendToSocket(mapped, true);
      } finally {
        pendingRequestSessions.delete(mapped.session_id);
      }
      if (!response) return;
      const decision = response?.hookSpecificOutput?.decision;
      if (!decision) return;
      if (decision.behavior === "deny") {
        await rejectQuestion(mapped._opencode_request_id);
        return;
      }
      const answers = decision.updatedInput?.answers;
      if (!answers) return;
      const answerArray = Object.values(answers).map((value) => [String(value)]);
      await replyQuestion(mapped._opencode_request_id, answerArray);
    }

    return {
      event: async ({ event }) => {
        const mapped = mapEvent(event);
        if (!mapped) return;

        const isReplyEvent = event.type === "permission.replied"
          || event.type === "question.replied"
          || event.type === "question.rejected";

        if (mapped.hook_event_name === "PermissionRequest" && mapped.tool_name === "AskUserQuestion") {
          await handleQuestionRequest(mapped);
          return;
        }

        if (mapped.hook_event_name === "PermissionRequest") {
          await handlePermissionRequest(mapped);
          return;
        }

        if (!isReplyEvent
          && pendingRequestSessions.has(mapped.session_id)
          && mapped.hook_event_name !== "SessionStart"
          && mapped.hook_event_name !== "SessionEnd") {
          return;
        }

        await sendToSocket(mapped);
      },
    };
  },
};
