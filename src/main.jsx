import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/dm-mono/400.css'
import '@fontsource/dm-mono/500.css'
import './styles.css'
import App from './App.jsx'
import { initStudio } from './theatre/index.js'

initStudio().then((studioOn) => {
  if (studioOn) document.documentElement.classList.add('studio')
})

createRoot(document.getElementById('root')).render(<App />)
