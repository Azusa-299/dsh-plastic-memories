import type { Context } from '@deepseek-ai/cordis'
// Type-only side-effect import: it merges `webServer` into Context.
import type {} from '@deepseek-ai/dsh-host-webserver'
import { listDiaries, readDiary } from './diary.ts'
import { DIARY_ROUTE } from './route.ts'

/** JSON response helper; the preview never caches because diaries change at any time. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * Serves the Settings page's diary preview: every diary name, or one diary's
 * text. The page offers no writes, so the route answers GET only.
 * @param ctx Host plugin context.
 * @param root Absolute diary directory.
 */
export function registerDiaryRoute(ctx: Context, root: string): void {
  // Without a web server (headless runs, the desktop file:// shell) the page
  // still loads and reports the preview as unavailable.
  ctx.inject(['webServer'], (child) => {
    child.effect(() => child.webServer.register({
      kind: 'exact',
      path: DIARY_ROUTE,
      resource: async (request) => {
        const name = new URL(request.url).searchParams.get('name')
        try {
          const diaries = await listDiaries(root)
          if (name === null || name.trim() === '') return json({ diaries })
          const selected = await readDiary(root, name)
          return json({ diaries, selected })
        } catch (error) {
          // `readDiary` only reads names it just listed, so a miss is a stale
          // preview rather than a bad path: report it as not found.
          const message = error instanceof Error ? error.message : String(error)
          return json({ error: message }, 404)
        }
      },
    }), 'plastic-memories: diary preview route')
  })
}
