const {getJson} = require("serpapi")
const express = require("express")
const path = require("path")
const fs = require("fs")
const {execFile} = require("child_process")

const app = express()
const port = 3000
const api_key = ""
const DOWNLOAD_DIR = path.join(__dirname, "download")

if(!fs.existsSync(DOWNLOAD_DIR)){
    fs.mkdirSync(DOWNLOAD_DIR)

}

app.use(express.json)
app.use(express.static(path.join(__dirname, "public")))
app.use("/download", express.static(DOWNLOAD_DIR))

app.get("/api/search", (req,res) => {
    const {q , count = 5} = req.q
    if(!q) {
        res.status(400).json({success: false, message: "Missing query"})
        return
    }
    getJson({
        engine: "google",
        q,
        count,
        api_key : API_KEY,
    }, (json) => {
        const videos = (json.short_video_results|| []).slice(0, parseInt(count))
        res.json({videos})
    })

    app.listen(port, () => {
        console.log(`server running on http://localhost:${port}`)
    })
})



