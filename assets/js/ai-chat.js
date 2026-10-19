(function () {
  const root = document.getElementById("ai-chat");
  if (!root) return;

  const endpoint = root.dataset.endpoint;
  const toggle = root.querySelector(".ai-chat-toggle");
  const panel = root.querySelector(".ai-chat-panel");
  const list = root.querySelector(".ai-chat-messages");
  const form = root.querySelector(".ai-chat-form");
  const input = form.querySelector("textarea");
  const send = form.querySelector("button");
  const history = [];

  function escapeHtml(text) {
    return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  // Small Markdown subset: links, bold, inline code, line breaks.
  function render(text) {
    return escapeHtml(text)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\n/g, "<br>");
  }

  function addMessage(role, text) {
    const el = document.createElement("div");
    el.className = "ai-chat-msg ai-chat-" + role;
    el.innerHTML = render(text);
    list.appendChild(el);
    list.scrollTop = list.scrollHeight;
    return el;
  }

  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      if (!list.children.length) addMessage("assistant", root.dataset.greeting);
      input.focus();
    }
  }

  toggle.addEventListener("click", () => setOpen(panel.hidden));
  root.querySelector(".ai-chat-close").addEventListener("click", () => setOpen(false));

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const question = input.value.trim();
    if (!question || send.disabled) return;

    input.value = "";
    send.disabled = true;
    addMessage("user", question);
    history.push({ role: "user", content: question });
    const pending = addMessage("assistant", "…");
    pending.classList.add("ai-chat-pending");

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.answer) throw new Error(data.error || "Request failed");
      pending.innerHTML = render(data.answer);
      history.push({ role: "assistant", content: data.answer });
    } catch (err) {
      pending.textContent = err.message || "Something went wrong, please try again later.";
      // Drop the unanswered question so the conversation stays well-formed.
      history.pop();
    } finally {
      pending.classList.remove("ai-chat-pending");
      send.disabled = false;
      list.scrollTop = list.scrollHeight;
      input.focus();
    }
  });
})();
