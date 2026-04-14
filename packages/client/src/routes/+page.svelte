<script lang="ts">
  let prompt = $state("");
  let answer = $state("");
  let loading = $state(false);
  let error = $state("");

  async function send() {
    if (!prompt.trim() || loading) return;

    loading = true;
    answer = "";
    error = "";

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      if (!res.ok) {
        error = `Server error: ${res.status} ${res.statusText}`;
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
      }
    } catch {
      error = "Could not reach the server. Is it running on port 9012?";
    } finally {
      loading = false;
    }
  }
</script>

<main class="bg-background text-foreground mx-auto min-h-screen max-w-2xl p-8">
  <h1 class="mb-8 text-2xl font-bold">Arivonriyam</h1>

  <div class="mb-6 flex gap-2">
    <input
      class="border-input bg-background placeholder:text-muted-foreground focus:ring-ring flex-1 rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
      type="text"
      bind:value={prompt}
      placeholder="Ask something..."
      onkeydown={(e) => e.key === "Enter" && send()}
      disabled={loading}
    />
    <button
      class="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
      onclick={send}
      disabled={loading || !prompt.trim()}
    >
      {loading ? "Sending…" : "Send"}
    </button>
  </div>

  {#if error}
    <p
      class="border-destructive bg-destructive/10 text-destructive rounded-md border px-4 py-3 text-sm"
    >
      {error}
    </p>
  {/if}

  {#if answer}
    <div
      class="border-border bg-card text-card-foreground rounded-md border p-4 text-sm leading-relaxed whitespace-pre-wrap"
    >
      {answer}
    </div>
  {/if}
</main>
