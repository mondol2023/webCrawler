require("dotenv").config()

const { getJson } = require("serpapi")
const express = require("express")
const path = require("path")
const fs = require("fs")
const { execFile } = require("child_process")

const app = express()
const port = Number(process.env.PORT) || 3000
const API_KEY = process.env.SERPAPI_KEY
const YTDLP_BIN = process.env.YTDLP_PATH || "yt-dlp"
const DOWNLOAD_DIR = path.join(__dirname, "download")
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000

if (!API_KEY) {
    console.error("SERPAPI_KEY is not set. Copy .env.example to .env and add your key.")
    process.exit(1)
}

fs.mkdirSync(DOWNLOAD_DIR, { recursive: true })

app.use(express.json())
app.use(express.static(path.join(__dirname, "public")))
app.use("/download", express.static(DOWNLOAD_DIR))

function clampCount(raw) {
    const n = parseInt(raw, 10)
    if (Number.isNaN(n)) return 5
    return Math.min(Math.max(n, 1), 20)
}

function toVideo(item) {
    return {
        title: item.title || "",
        link: item.link || "",
        thumbnail: item.thumbnail || "",
        source: item.source || item.channel || "",
        duration: item.duration || "",
    }
}

app.get("/api/search", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : ""
    if (!q) {
        res.status(400).json({ success: false, message: "Missing query" })
        return
    }
    const count = clampCount(req.query.count)

    try {
        const json = await getJson({ engine: "google", q, api_key: API_KEY })
        const raw = json.short_video_results || json.short_videos || json.inline_videos || json.video_results || []
        const videos = raw.map(toVideo).filter((v) => v.link).slice(0, count)
        res.json({ videos })
    } catch (error) {
        console.error("Search failed:", error instanceof Error ? error.message : error)
        res.status(502).json({ success: false, message: "Search failed" })
    }
})

app.post("/api/download", (req, res) => {
    const { url } = req.body || {}
    let parsed
    try {
        parsed = new URL(url)
    } catch {
        res.status(400).json({ success: false, message: "Invalid url" })
        return
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        res.status(400).json({ success: false, message: "Only http(s) urls are allowed" })
        return
    }

    const args = [
        "-o", path.join(DOWNLOAD_DIR, "%(id)s.%(ext)s"),
        "--no-playlist",
        "--no-simulate",
        "--print", "after_move:filepath",
        "--",
        parsed.href,
    ]
    execFile(YTDLP_BIN, args, { timeout: DOWNLOAD_TIMEOUT_MS, windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
            const message = error.code === "ENOENT"
                ? "yt-dlp not found. Install it or set YTDLP_PATH."
                : "Download failed"
            console.error("yt-dlp failed:", error.code === "ENOENT" ? error.message : stderr || error.message)
            res.status(500).json({ success: false, message })
            return
        }
        const lines = stdout.trim().split(/\r?\n/).filter(Boolean)
        const filepath = lines[lines.length - 1]
        if (!filepath) {
            res.status(500).json({ success: false, message: "yt-dlp produced no file" })
            return
        }
        res.json({ success: true, file: path.basename(filepath) })
    })
})

app.listen(port, () => {
    console.log(`server running on http://localhost:${port}`)
})
