let currentVideos = []

async function search() {
    const q = document.getElementById("q").value.trim()
    const count = document.getElementById("count").value

    if (!q)
        return

    const btn = document.getElementById("searchBtn")
    btn.disabled = true
    btn.textContent = "Searching..."
    setStatus("Searching...")
    document.getElementById("results").replaceChildren()
    document.getElementById("download-bar").style.display = "none"

    try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(q)}&count=${encodeURIComponent(count)}`)
        const data = await response.json()
        if (!response.ok) {
            setStatus(`Error: ${data.message || response.status}`)
            return
        }
        currentVideos = data.videos || []

        if (currentVideos.length === 0) {
            setStatus("No results found")
            return
        }
        setStatus(`Found ${currentVideos.length} video(s)`)
        document.getElementById("download-bar").style.display = "flex"
        renderVideos()
    }
    catch (error) {
        setStatus(`Error: ${error.message}`)
    }
    finally {
        btn.disabled = false
        btn.textContent = "Search"
    }
}

function renderVideos() {
    const grid = document.getElementById("results")
    const cards = currentVideos.map((video, i) => {
        const card = document.createElement("div")
        card.className = "card"
        card.id = `card-${i}`

        if (video.thumbnail) {
            const img = document.createElement("img")
            img.src = video.thumbnail
            img.alt = video.title
            card.appendChild(img)
        }

        const body = document.createElement("div")
        body.className = "card-body"

        const title = document.createElement("p")
        title.textContent = video.title

        const source = document.createElement("p")
        source.className = "source"
        source.textContent = `${video.source || "unknown"} · ${video.duration || "unknown"}`

        const button = document.createElement("button")
        button.id = `btn-${i}`
        button.textContent = "Download"
        button.addEventListener("click", () => downloadOne(i))

        const link = document.createElement("a")
        link.id = `link-${i}`
        link.hidden = true

        body.append(title, source, button, link)
        card.appendChild(body)
        return card
    })
    grid.replaceChildren(...cards)
}

async function downloadOne(index) {
    const video = currentVideos[index]
    const btn = document.getElementById(`btn-${index}`)
    if (!video || btn.disabled)
        return

    btn.disabled = true
    btn.classList.remove("error", "done")
    btn.textContent = "Downloading..."
    setStatus(`Downloading ${video.title}...`)

    try {
        const res = await fetch("/api/download", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                url: video.link,
                title: video.title
            })
        })
        const data = await res.json()

        if (data.success) {
            btn.textContent = "Downloaded"
            btn.classList.add("done")
            const link = document.getElementById(`link-${index}`)
            link.href = `/download/${encodeURIComponent(data.file)}`
            link.textContent = data.file
            link.setAttribute("download", data.file)
            link.hidden = false
            setStatus(`Downloaded ${video.title}`)
        }
        else {
            btn.textContent = "Retry download"
            btn.classList.add("error")
            btn.disabled = false
            setStatus(`Download failed: ${data.message || "unknown error"}`)
        }
    }
    catch (error) {
        setStatus(`Error: ${error.message}`)
        btn.textContent = "Download"
        btn.disabled = false
    }
}

async function downloadAll() {
    for (let i = 0; i < currentVideos.length; i++) {
        await downloadOne(i)
    }
}

function setStatus(msg) {
    document.getElementById("status").textContent = msg
}

document.getElementById("searchBtn").addEventListener("click", search)
document.getElementById("q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") search()
})
document.getElementById("downloadAllBtn").addEventListener("click", downloadAll)
