import WebTorrent from "webtorrent";
import archiver from "archiver";
import { Transform, TransformCallback } from "stream";
import { Readable } from "stream";

const testMagnet = `magnet:?xt=urn:btih:38979EE94106A4F586AA024649B0ABE331F49141`;

interface ZipStream {
  zip: archiver.Archiver;
  zipStream: Transform;
}

interface FileMetadata {
  index: number;
  name: string;
  size: number;
  path: string;
}

interface TorrentMetadata {
  files: FileMetadata[];
}

// Helper function to create a ZIP stream from torrent files
async function createZipStream(
  files: WebTorrent.TorrentFile[],
): Promise<ZipStream> {
  const zip = archiver("zip", {
    zlib: { level: 5 }, // Set compression level
  });

  const zipStream = new Transform({
    transform(chunk: any, encoding: string, callback: TransformCallback): void {
      callback(null, chunk);
    },
  });

  zip.pipe(zipStream);

  // Add each file to the ZIP
  for (const file of files) {
    const stream = file.createReadStream();

    const readable = Readable.from(stream);
    zip.append(readable, { name: file.path });
  }

  return { zip, zipStream };
}

export const GET = async (request: Request) => {
  // Configure CORS headers for API access
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  } as const;

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  const url = new URL(request.url);
  const torrentUrl = url.searchParams.get("torrent") || testMagnet;
  const explore = url.searchParams.get("explore") === "true";
  if (!torrentUrl) {
    return new Response("Missing torrent parameter", {
      status: 400,
      headers,
    });
  }

  try {
    const client = new WebTorrent();

    // Create a promise that resolves when the torrent is ready
    const torrent: WebTorrent.Torrent = await new Promise((resolve, reject) => {
      client.add(torrentUrl, (torrent) => {
        resolve(torrent);
      });

      // Set a timeout to prevent hanging
      setTimeout(() => {
        reject(new Error("Torrent load timeout"));
      }, 30000);
    });

    // Add metadata about files
    const metadata: TorrentMetadata = {
      files: torrent.files.map((f, index) => ({
        index,
        name: f.name,
        size: f.length,
        path: f.path,
      })),
    };

    if (explore) {
      return new Response(JSON.stringify(metadata, undefined, 2), {
        headers: { "content-type": "application/json" },
      });
    }

    // Get requested file index from query params or stream all
    const fileIndex = url.searchParams.get("file");

    if (fileIndex !== null) {
      // Stream single requested file
      const file = torrent.files[parseInt(fileIndex, 10)];
      if (!file) {
        return new Response("File index not found", {
          status: 404,
          headers,
        });
      }

      const streamHeaders = {
        ...headers,
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${file.name}"`,
        "Transfer-Encoding": "chunked",
      } as const;

      const stream = file.createReadStream();

      const webStream = Readable.from(stream);

      return new Response(webStream, {
        headers: streamHeaders,
      });
    }

    // Stream all files as zip
    const streamHeaders = {
      ...headers,
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="torrent-files.zip"',
      "Transfer-Encoding": "chunked",
    } as const;

    // Create a ZIP archive containing all files
    const { zip, zipStream } = await createZipStream(torrent.files);

    zip.append(Buffer.from(JSON.stringify(metadata, null, 2)), {
      name: "metadata.json",
    });
    zip.finalize();

    return new Response(Readable.from(zipStream), {
      headers: streamHeaders,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return new Response(`Error: ${errorMessage}`, {
      status: 500,
      headers,
    });
  }
};
