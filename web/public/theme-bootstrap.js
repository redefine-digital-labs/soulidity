(function () {
  'use strict'

  var cookieName = 'soulidity_visual_theme'
  var storageKey = 'soulidity-visual-theme'
  var valid = { auto: true, animacraft: true, soulidity: true }

  function readCookie() {
    var prefix = cookieName + '='
    var parts = document.cookie ? document.cookie.split(';') : []
    for (var index = 0; index < parts.length; index += 1) {
      var part = parts[index].trim()
      if (part.indexOf(prefix) !== 0) continue
      try {
        var value = decodeURIComponent(part.slice(prefix.length))
        return valid[value] ? value : null
      } catch (_) {
        return null
      }
    }
    return null
  }

  function readStorage() {
    try {
      var value = window.localStorage.getItem(storageKey)
      return valid[value] ? value : null
    } catch (_) {
      return null
    }
  }

  function writeStorage(value) {
    try {
      window.localStorage.setItem(storageKey, value)
    } catch (_) {
      // A valid cookie still keeps the theme stable when storage is denied.
    }
  }

  function isSoulidityHost(hostname) {
    var normalized = hostname.toLowerCase().replace(/\.$/, '')
    return normalized === 'soulidity.ai' || normalized.endsWith('.soulidity.ai')
  }

  function writeCookie(value) {
    var segments = [
      cookieName + '=' + encodeURIComponent(value),
      'Path=/',
      'Max-Age=31536000',
      'SameSite=Lax',
    ]
    if (isSoulidityHost(window.location.hostname)) {
      segments.push('Domain=.soulidity.ai')
    }
    if (window.location.protocol === 'https:') {
      segments.push('Secure')
    }
    document.cookie = segments.join('; ')
  }

  var preference = readCookie() || readStorage() || 'auto'
  var resolved = preference === 'animacraft' ? 'animacraft' : 'soulidity'
  var root = document.documentElement

  root.setAttribute('data-theme-preference', preference)
  root.setAttribute('data-theme', resolved)
  root.style.colorScheme = resolved === 'animacraft' ? 'light' : 'dark'

  var meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    meta.setAttribute('content', resolved === 'animacraft' ? '#f3f7f8' : '#0d0a1e')
  }
  var colorSchemeMeta = document.querySelector('meta[name="color-scheme"]')
  if (colorSchemeMeta) {
    colorSchemeMeta.setAttribute('content', resolved === 'animacraft' ? 'light' : 'dark')
  }

  writeCookie(preference)
  writeStorage(preference)
})()
