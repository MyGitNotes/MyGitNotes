/**
 * Answers a page load: the network's answer, and the cached app shell only when the network cannot answer (it failed, or the
 * server answered 5xx), which the app turns into its own offline state. A slow answer is waited for, never replaced by the shell:
 * after a deployment the cached shell is the previous build, whose lazy files the server no longer has.
 */
export async function navigateWithShell(request: Request, fetchPage: (request: Request) => Promise<Response>, shell: () => Promise<Response | undefined>): Promise<Response> {
  try {
    const response = await fetchPage(request);
    if (response.status >= 500) return (await shell()) ?? response;
    return response;
  } catch (error) {
    const cached = await shell();
    if (cached) return cached;
    throw error;
  }
}
