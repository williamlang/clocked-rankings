import { Hono } from 'hono'
import { renderRankingsPage } from './page.js'

export const app = new Hono()

const BOOT_ID = Date.now().toString()

// Long-lived SSE — browser reconnects after server restart and sees a new BOOT_ID → reload.
app.get('/__reload', c => {
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.enqueue(new TextEncoder().encode(`data: ${BOOT_ID}\n\n`))
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
})

app.get('/', c => c.html(renderRankingsPage()))
