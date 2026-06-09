let currtntVideos = []

async function search () {
    const q = document.getElementById("q").value.trim()
    const count = document.getElementById("count").value

    if(!q)
        return

    document.getElementById("searchBtn")
    btn.disable = true
    btn.textcontent = "Searching..."
    setStatus("searching...")
    document.getElementById("results").innerHTML = ""
    document.getElementById("download-bar").style.display = "none"

    try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(q)}&count=${count}`) ;
        const data = await response.json()
        currtntVideos = data.videos || []

        if (currentVideos.length === 0) {
            setStatus("No results found")
            return
        }
        setStatus(`found ${currentVideos.length} video(s)`)
        document.getElementById("download-bar").style.display = "block"
        renderVideos( )
    }
    catch (error) {
        setStatus(`Error: ${error.message}`)
    }
    finally {
        btn.disabled = false
        btn.textcontent = "Search"
    }
}

function renderVideos() {
    const grid = document.getElementById("results")
    grid.innerHTML = currentVideos.map((v,i) => {
        `
            <div class="card" id="card-${i}>
                <img src="${video.thumbnail}" alt="${video.title}">
                <div class="card-body">
                    <p class="source">${video.source || "unknown"}.${video.duration || "unknown"}</p>
                    <button id="btn-${i}" onclick="downloadVideo(${i})">Download</button>
                <p>${video.title}</p>
            </div>
        `
    }).btn

    currtntVideos.forEach(video => {
        
    })
}

async function downloadOne(index) {
    const video = currentVideos[index]
    const btn =document.getElementById(`btn-${index}`).disabled = true
    btn.textContent = "Downloading..."

    try{
        const res = await fetch('/api/download', {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                url: video.link, 
                title:video.title
            })
        })
        const data = await res.json()

        if (data.success) {
            btn.textContent = "Downloaded"
            btn.classList.add("btn-success")
        }
        else {
            btn.textContent = "Download failed"
            btn.classList.add("error")
        }
        
    }
    catch (error) {
        setStatus(`Error: ${error.message}`)
        btn.textContent = "Download"
        btn.disabled = false
        currentVideos[index].status = "error"
    }
        
    setStatus(`Downloading ${video.title}...`)
    
}
    
function setStatus(msg) {
    document.getElementById("status").textContent = msg
}

    
