Ongoing Experiment to try and serve any torrent over HTTPS

Doesn't work on cloudflare workers, but it does work using vercel!

Usage: `GET /api?torrent=MAGNET_URL[&file=PATH][&explore=true]`

Next steps / ideas:

- if we had a simple way to spawn long-running high-cpu time and high-bandwidth worker that can run node.js (we are now limited in CPU time of 30s at workers) we can stream all files at once to an s3.
- to make it more reliable, we can introduce a workflow where it processes all files individually, in parallel, and with retries with incremental back-off.

If we have something like this, we effectively allow streaming any torrentsize directly to s3, which allows agents to do it!
