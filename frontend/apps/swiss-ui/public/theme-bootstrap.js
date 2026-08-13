(() => {
  try {
    const theme = localStorage.getItem("uiTheme") === "light" ? "light" : "dark"
    document.documentElement.classList.remove("light", "dark")
    document.documentElement.classList.add(theme)
    document.documentElement.dataset.theme = theme
  } catch {
    document.documentElement.classList.add("dark")
  }
})()
