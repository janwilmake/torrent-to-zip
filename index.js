//would it be possible to create a torrent downloader in a couldflare worker that downloads a specific torrent?
//I aim to build this for legal torrent URLs such as hugging face GGUF files

// Note: This requires the WebTorrent and archiver packages to be added to your worker dependencies
import WebTorrent from 'webtorrent'
import archiver from 'archiver'
import { Readable, Transform } from 'stream'

// Helper function to create a ZIP stream from torrent files
async function createZipStream(files) {
  const zip = archiver('zip', {
    zlib: { level: 5 } // Set compression level
  })
  
  const zipStream = new Transform({
    transform(chunk, encoding, callback) {
      callback(null, chunk)
    }
  })
  
  zip.pipe(zipStream)
  
  // Add each file to the ZIP
  for (const file of files) {
    const stream = file.createReadStream()
    zip.append(stream, { name: file.path })
  }
  
  return { zip, zipStream }
}

export default {
  async fetch(request, env, ctx) {
    // Configure CORS headers for API access
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers })
    }

    const url = new URL(request.url)
    const torrentUrl = url.searchParams.get('torrent')

    if (!torrentUrl) {
      return new Response('Missing torrent parameter', { 
        status: 400,
        headers 
      })
    }

    // Validate that this is a known safe torrent source
    const safeHosts = ['huggingface.co']
    const torrentHost = new URL(torrentUrl).hostname
    
    if (!safeHosts.includes(torrentHost)) {
      return new Response('Invalid torrent source', {
        status: 403,
        headers
      })
    }

    try {
      const client = new WebTorrent()
      
      // Create a promise that resolves when the torrent is ready
      const torrent = await new Promise((resolve, reject) => {
        client.add(torrentUrl, (torrent) => {
          resolve(torrent)
        })

        // Set a timeout to prevent hanging
        setTimeout(() => {
          reject(new Error('Torrent load timeout'))
        }, 30000)
      })

      // Get requested file index from query params or stream all
      const fileIndex = url.searchParams.get('file')
      
      if (fileIndex !== null) {
        // Stream single requested file
        const file = torrent.files[parseInt(fileIndex, 10)]
        if (!file) {
          return new Response('File index not found', { 
            status: 404,
            headers 
          })
        }
        
        const streamHeaders = {
          ...headers,
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${file.name}"`,
          'Transfer-Encoding': 'chunked'
        }
        
        return new Response(file.createReadStream(), {
          headers: streamHeaders
        })
      }
      
      // Stream all files as zip
      const streamHeaders = {
        ...headers,
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="torrent-files.zip"',
        'Transfer-Encoding': 'chunked'
      }
      
      // Create a ZIP archive containing all files
      const { zip, zipStream } = await createZipStream(torrent.files)
      
      // Add metadata about files
      const metadata = {
        files: torrent.files.map((f, index) => ({
          index,
          name: f.name,
          size: f.length,
          path: f.path
        }))
      }
      
      zip.addFile('metadata.json', Buffer.from(JSON.stringify(metadata, null, 2)))
      zip.finalize()
      
      return new Response(zipStream, {
        headers: streamHeaders
      })

    } catch (error) {
      return new Response(`Error: ${error.message}`, {
        status: 500,
        headers
      })
    }
  }
}

// wrangler.toml configuration
/*
name = "torrent-downloader"
main = "src/worker.js"
compatibility_date = "2024-01-01"

[build]
command = "npm install webtorrent"
*/
