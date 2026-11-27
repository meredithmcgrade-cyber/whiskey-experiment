import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'
import Scene from './scene/Scene.jsx'
import { days, finale, footer, hero, question } from './content.js'
import { sound } from './audio.js'

// JS counts days from Sunday. The site counts from Monday.
const todayId = days[(new Date().getDay() + 6) % 7].id

function useSmoothScroll() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const lenis = new Lenis({ autoRaf: true, anchors: true, lerp: 0.09 })
    return () => lenis.destroy()
  }, [])
}

// Adds the "in" class to anything with data-reveal once it scrolls into view,
// and reports which section is currently in the middle of the screen.
function useSections() {
  const [active, setActive] = useState('home')
  useEffect(() => {
    const reveal = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.target.classList.toggle('in', e.isIntersecting)),
      { threshold: 0.35 }
    )
    document.querySelectorAll('[data-reveal]').forEach((el) => reveal.observe(el))

    const spy = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setActive(e.target.id)),
      { rootMargin: '-50% 0px -50% 0px' }
    )
    document.querySelectorAll('[data-section]').forEach((el) => spy.observe(el))
    return () => {
      reveal.disconnect()
      spy.disconnect()
    }
  }, [])
  return active
}

function Nav({ active }) {
  const nav = useRef(null)
  const [pill, setPill] = useState({ x: 0, width: 0, visible: false, ready: false })

  // The amber highlight is one element that slides to whichever link is
  // active. It is measured from the link itself so it always fits the label.
  useLayoutEffect(() => {
    const measure = () => {
      const link = nav.current?.querySelector('.is-active')
      setPill((prev) =>
        link
          ? { x: link.offsetLeft, width: link.offsetWidth, visible: true, ready: prev.visible }
          : { ...prev, visible: false }
      )
    }
    measure()
    window.addEventListener('resize', measure)
    document.fonts?.ready.then(measure)
    return () => window.removeEventListener('resize', measure)
  }, [active])

  return (
    <nav className="nav" aria-label="Days of the week" ref={nav}>
      <span
        className={`nav__pill ${pill.visible ? 'is-visible' : ''} ${pill.ready ? 'is-ready' : ''}`}
        style={{ transform: `translateX(${pill.x}px)`, width: pill.width }}
        aria-hidden="true"
      />
      <a href="#home" className={active === 'home' ? 'is-active' : ''}>
        Home
      </a>
      {days.map((d) => (
        <a
          key={d.id}
          href={`#${d.id}`}
          className={[active === d.id ? 'is-active' : '', d.id === todayId ? 'is-today' : ''].join(' ')}
          aria-current={active === d.id ? 'true' : undefined}
        >
          <span className="nav__long">{d.name}</span>
          <span className="nav__short" aria-hidden="true">
            {d.short}
          </span>
        </a>
      ))}
    </nav>
  )
}

// Splits a line into words that rise in one after another. Screen readers
// get the whole sentence from the label and skip the pieces.
function Words({ text, as: Tag = 'p', className = '', step = 28, lead }) {
  const words = text.split(' ')
  return (
    <Tag className={`words ${className}`} aria-label={lead ? `${lead} ${text}` : text} style={{ '--step': `${step}ms` }}>
      {lead && (
        <span className="words__word words__lead" aria-hidden="true" style={{ '--i': 0 }}>
          {lead}{' '}
        </span>
      )}
      {words.map((word, i) => (
        <span key={i} className="words__word" aria-hidden="true" style={{ '--i': i + (lead ? 1 : 0) }}>
          {word}{' '}
        </span>
      ))}
    </Tag>
  )
}

function SoundToggle() {
  const [on, setOn] = useState(false)
  return (
    <button type="button" className="sound" aria-pressed={on} onClick={() => setOn(sound.toggle())}>
      <span className="sound__bars" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      Sound {on ? 'on' : 'off'}
    </button>
  )
}

function Checker({ active }) {
  const day = days.find((d) => d.id === active)
  const pending = active === 'home'
  const label = day ? day.name : pending ? 'Stand by' : 'Every day'
  return (
    <p className="checker" aria-hidden="true">
      <span className="checker__key">Checking</span>
      <span className="checker__value" key={label}>
        {label}
      </span>
      <span className="checker__arrow">&rarr;</span>
      <span className={`checker__value checker__value--result ${pending ? 'is-pending' : ''}`} key={String(pending)}>
        {pending ? 'Pending' : "It's Wednesday"}
      </span>
    </p>
  )
}

export default function App() {
  useSmoothScroll()
  const active = useSections()

  return (
    <>
      <div className="stage" aria-hidden="true">
        <Scene />
      </div>

      <header className="topbar">
        <Nav active={active} />
        <div className="topbar__row">
          <Checker active={active} />
          <SoundToggle />
        </div>
      </header>

      <main>
        <section id="home" className="screen hero" data-section>
          <h1 className="hero__title">{hero.title}</h1>
          <a className="hero__hint" href={`#${days[0].id}`}>
            <span>{hero.hint}</span>
            <i aria-hidden="true" />
          </a>
        </section>

        {days.map((d, i) => (
          <section
            key={d.id}
            id={d.id}
            className={`screen day ${i % 2 === 0 ? 'day--left' : 'day--right'}`}
            data-section
          >
            <div className="day__copy" data-reveal>
              <p className="eyebrow">
                <span className="eyebrow__num">{String(i + 1).padStart(2, '0')}</span>
                {d.name}
                {d.id === todayId && <span className="eyebrow__today">Today</span>}
              </p>
              <p className="day__question">{question}</p>
              <Words className="day__answer" text={d.answer} />
            </div>
          </section>
        ))}

        <section id="still" className="finale" data-section>
          <div className="screen finale__block" data-reveal>
            <Words as="h2" className="finale__question" text={finale.question} lead={finale.lead} step={60} />
          </div>
          <div className="screen finale__block" data-reveal>
            <Words className="finale__answer" text={finale.answer} step={110} />
          </div>
          <div className="screen finale__block" data-reveal>
            <Words className="finale__body" text={finale.body} step={11} />
          </div>
        </section>
      </main>

      <footer className="footer">
        <p className="footer__title">{footer.title}</p>
        <div className="footer__cols">
          <div>
            <p className="eyebrow">{footer.linksLabel}</p>
            {footer.links.map((l) => (
              <a key={l.href} className="link link--out" href={l.href} target="_blank" rel="noreferrer">
                {l.label}
              </a>
            ))}
          </div>
        </div>
        <p className="footer__credit">{footer.credit}</p>
      </footer>
    </>
  )
}
