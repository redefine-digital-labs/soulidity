'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/components/providers/auth-provider'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { Button, buttonStyles } from '@/components/ui/button'
import { useLogin } from '@/lib/hooks/use-login'
import { createNativeReceiverSession, nativeReceiverScope, nativeMessageRequest, receiveNativeRequest, validNativeHandoff, type NativeHandoff, type NativeRequest } from '@/lib/animacraft/native-handoff'
import { receiveBrowserNativeRequest } from '@/lib/animacraft/browser-native-receive'

export const ANIMACRAFT_INTEGRATION_LOCALES = ['en', 'zh', 'ja', 'ko', 'vi'] as const
type Locale = (typeof ANIMACRAFT_INTEGRATION_LOCALES)[number]
const EN_MESSAGES = { title: 'Receive your Soul', subtitle: 'Verify your completed Animacraft Soul and recover account sync. No mint or transaction signing here.', waiting: 'Waiting for Animacraft', checking: 'Verifying with Soulidity', ready: 'Ready to receive', complete: 'Soul received', invalid: 'Invalid or retired handoff. Open this page from Animacraft.', retryRequired: 'Sign in with the same wallet account, then retry verification.', login: 'Sign in', retry: 'Retry verification', mySouls: 'My Souls', openSoul: 'Open Soul', back: 'Back to Animacraft', language: 'Language' } as const
type MessageKey = keyof typeof EN_MESSAGES
export const ANIMACRAFT_INTEGRATION_MESSAGES = {
  en: EN_MESSAGES,
  zh: { title: '接收你的 Soul', subtitle: '验证已完成的 Animacraft Soul 并恢复账号同步。本页不会铸造或签署交易。', waiting: '等待 Animacraft', checking: '正在向 Soulidity 验证', ready: '已准备接收', complete: 'Soul 已接收', invalid: '交接无效或已停用。请从 Animacraft 打开本页。', retryRequired: '请登录同一个钱包账号，然后重试验证。', login: '登录', retry: '重试验证', mySouls: '我的 Soul', openSoul: '打开 Soul', back: '返回 Animacraft', language: '语言' },
  ja: { title: 'Soul を受け取る', subtitle: '完成した Animacraft Soul を検証し同期を再開します。発行や取引署名は行いません。', waiting: 'Animacraft を待っています', checking: 'Soulidity で検証中', ready: '受信準備完了', complete: 'Soul を受信しました', invalid: '無効な引き継ぎです。Animacraft から開いてください。', retryRequired: '同じウォレットでログインし、再試行してください。', login: 'ログイン', retry: '検証を再試行', mySouls: '自分の Soul', openSoul: 'Soul を開く', back: 'Animacraft に戻る', language: '言語' },
  ko: { title: 'Soul 받기', subtitle: '완료된 Animacraft Soul을 검증하고 동기화를 재개합니다. 발행하거나 거래에 서명하지 않습니다.', waiting: 'Animacraft 대기 중', checking: 'Soulidity 검증 중', ready: '수신 준비 완료', complete: 'Soul 수신 완료', invalid: '유효하지 않은 연결입니다. Animacraft에서 열어 주세요.', retryRequired: '같은 지갑 계정으로 로그인하고 다시 시도하세요.', login: '로그인', retry: '검증 다시 시도', mySouls: '내 Soul', openSoul: 'Soul 열기', back: 'Animacraft로 돌아가기', language: '언어' },
  vi: { title: 'Nhận Soul của bạn', subtitle: 'Xác minh Soul Animacraft đã hoàn tất và tiếp tục đồng bộ. Không mint hoặc ký giao dịch ở đây.', waiting: 'Đang chờ Animacraft', checking: 'Đang xác minh với Soulidity', ready: 'Sẵn sàng nhận', complete: 'Đã nhận Soul', invalid: 'Liên kết không hợp lệ. Hãy mở từ Animacraft.', retryRequired: 'Đăng nhập cùng tài khoản ví rồi thử lại.', login: 'Đăng nhập', retry: 'Thử xác minh lại', mySouls: 'Soul của tôi', openSoul: 'Mở Soul', back: 'Về Animacraft', language: 'Ngôn ngữ' },
} satisfies Record<Locale, Record<MessageKey, string>>
const ANIMACRAFT_INTEGRATION_LOCALE_KEY = 'soulidity-animacraft-locale'
export function normalizeAnimacraftIntegrationLocale(value: string | null | undefined): Locale | null {
  const language = String(value ?? '').toLowerCase().replace('_', '-').split('-')[0]
  if (language === 'jp') return 'ja'
  if (language === 'kr') return 'ko'
  return ANIMACRAFT_INTEGRATION_LOCALES.includes(language as Locale) ? language as Locale : null
}
export function formatAnimacraftIntegrationMessage(locale: Locale, key: MessageKey) { return ANIMACRAFT_INTEGRATION_MESSAGES[locale][key] }
function browserLocale(): Locale {
  const requested = new URLSearchParams(window.location.search).get('lang')
  let stored: string | null = null
  try { stored = window.localStorage.getItem(ANIMACRAFT_INTEGRATION_LOCALE_KEY) } catch {}
  for (const value of [requested, stored, ...window.navigator.languages]) {
    const locale = normalizeAnimacraftIntegrationLocale(value)
    if (locale) return locale
  }
  return 'en'
}
export function AnimacraftIntegrationClient({ handoff }: { handoff: NativeHandoff }) {
  const { user, loading } = useAuth()
  const activeAddress = useRef<string | null>(null)
  useLayoutEffect(() => { activeAddress.current = loading ? null : user?.primarySuiAddress ?? null }, [loading, user?.primarySuiAddress])
  const login = useLogin()
  const valid = useMemo(() => validNativeHandoff(handoff), [handoff])
  const [locale, setLocale] = useState<Locale>(() => typeof window === 'undefined' ? 'en' : browserLocale())
  const [, redraw] = useState(0)
  const scopeKey = nativeReceiverScope(handoff, user, loading)
  const session = useMemo(() => {
    const next = createNativeReceiverSession()
    next.setScope(scopeKey)
    return next
  }, [scopeKey])
  const { status, soulId, pending, last, errorMessage } = session.snapshot()
  const t = (key: MessageKey) => formatAnimacraftIntegrationMessage(locale, key)
  useLayoutEffect(() => {
    session.setScope(scopeKey)
    return () => session.dispose()
  }, [session, scopeKey])
  async function run(request: NativeRequest, retry = false) {
    if (!valid || !window.opener || !session.matchesScope(scopeKey)) return
    const opener = window.opener
    await session.run(request, () => receiveNativeRequest(request,
      frozen => receiveBrowserNativeRequest(frozen, () => activeAddress.current)), response => {
      if (window.opener === opener) window.opener.postMessage(response, handoff.returnOrigin)
    }, () => redraw(value => value + 1), retry)
  }
  useEffect(() => {
    function receive(event: MessageEvent) {
      const request = nativeMessageRequest(event, window.opener, handoff)
      if (!request) return
      void run(request)
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  })
  function changeLocale(value: string) {
    const next = normalizeAnimacraftIntegrationLocale(value)
    if (!next) return
    setLocale(next)
    try { window.localStorage.setItem(ANIMACRAFT_INTEGRATION_LOCALE_KEY, next) } catch {}
    const url = new URL(window.location.href); url.searchParams.set('lang', next)
    window.history.replaceState(null, '', url)
  }
  return <PageContainer>
    <SectionHeader title={t('title')} subtitle={t('subtitle')} />
    <div className="space-y-6 rounded-2xl border border-border bg-card p-6">
      <label>{t('language')} <select value={locale} onChange={event => changeLocale(event.target.value)}>
        {ANIMACRAFT_INTEGRATION_LOCALES.map((value, index) => <option key={value} value={value}>{['English', '简体中文', '日本語', '한국어', 'Tiếng Việt'][index]}</option>)}
      </select></label>
      <p role="status">{t(valid ? status : 'invalid')}</p>
      {valid && errorMessage && <p role="alert">{errorMessage}</p>}
      {!user && <Button onClick={login} disabled={loading}>{t('login')}</Button>}
      {valid && <Button disabled={pending || !last} onClick={() => { if (last) void run(last, true) }}>{t('retry')}</Button>}
      <nav className="flex flex-wrap gap-3">
        <Link className={buttonStyles({ variant: 'outline' })} href="/my-souls">{t('mySouls')}</Link>
        {soulId && <Link className={buttonStyles({ variant: 'outline' })} href={`/souls/${encodeURIComponent(soulId)}`}>{t('openSoul')}</Link>}
        {valid && <a className={buttonStyles({ variant: 'outline' })} href={handoff.returnOrigin}>{t('back')}</a>}
      </nav>
    </div>
  </PageContainer>
}
