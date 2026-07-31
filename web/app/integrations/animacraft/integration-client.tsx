'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSuiClient } from '@mysten/dapp-kit'
import { formatAtomicAmountForDisplay } from '@soulidity/sdk'
import { useAuth } from '@/components/providers/auth-provider'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { Button, buttonStyles } from '@/components/ui/button'
import { useLogin } from '@/lib/hooks/use-login'
import { useAnimacraftMint } from '@/lib/hooks/use-animacraft-mint'
import {
  normalizeAnimacraftMintRecoveryContext,
} from '@/lib/animacraft/mint-recovery-context'
import {
  assertAnimacraftWalrusPatchUrl,
  fetchAnimacraftPassesV5,
  fetchAnimacraftOcPackage,
  getAnimacraftIntegrationConfig,
  parseAnimacraftMakerObject,
  parseAnimacraftMakerRootV5Object,
  parseAnimacraftMakerTreasuryV5Object,
  parseAnimacraftProtocolTreasuryV5Object,
  parseAnimacraftProtocolV5Object,
  verifyAnimacraftCommerceV5State,
  type AnimacraftCommerceV5State,
  type AnimacraftMakerState,
  type ParsedAnimacraftHandoff,
} from '@/lib/animacraft/handoff'
import { cn } from '@/lib/utils/cn'

interface AnimacraftHandoff {
  makerId: string
  profileUrl: string
  imageUrl: string
  profileBlobId: string
  imageBlobId: string
  imagePreviewBlobId: string
  recipeHash: string
  walletHint: string
  commerceRootId: string
  commerceTreasuryId: string
  returnOrigin: string
  returnNonce: string
  outputSealId: string
  outputNonce: string
  outputDigest: string
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error'

export const ANIMACRAFT_INTEGRATION_LOCALES = ['en', 'zh', 'ja', 'ko', 'vi'] as const

export type AnimacraftIntegrationLocale =
  (typeof ANIMACRAFT_INTEGRATION_LOCALES)[number]

const EN_MESSAGES = {
  languageLabel: 'Language',
  languageEnglish: 'English',
  languageChinese: '简体中文',
  languageJapanese: '日本語',
  languageKorean: '한국어',
  languageVietnamese: 'Tiếng Việt',
  notSupplied: 'Not supplied',
  handoffIncomplete:
    'The Animacraft handoff is incomplete. Return to Animacraft and certify the OC files again.',
  commerceNotActivated: 'Animacraft commerce v5 is not activated: {details}',
  commerceBindingMissing:
    'The Animacraft commerce v5 handoff is missing MakerRootV5 or MakerTreasuryV5.',
  connectWalletForPasses:
    'Connect the Animacraft wallet before verifying commerce v5 Passes.',
  handoffValidationFailed: 'Animacraft handoff validation failed.',
  recipeValidationFailed:
    'The certified Animacraft recipe does not match the current on-chain quote.',
  insufficientUsdc: 'This wallet does not have enough USDC for this Complete.',
  walrusFailed: 'Walrus could not verify or prepare all required Soul files.',
  unexpectedError:
    'This Animacraft handoff could not be completed. Review the technical details and try again.',
  technicalDetails: 'Technical details',
  statusIdle: 'Not started',
  statusLoading: 'Checking',
  statusReady: 'Ready',
  statusError: 'Failed',
  mintChecking: 'Checking Maker and recipe...',
  mintRegistering: 'Registering Living Content...',
  mintMinting: 'Minting canonical Soul...',
  mintSyncing: 'Syncing My Souls...',
  mintResume: 'Resume Soulidity sync',
  packageUpgradeRequired: 'Package upgrade required',
  signCompletePrice: 'Sign Complete · {price}',
  signFreeComplete: 'Sign free Complete',
  mintForPrice: 'Mint for {price}',
  mintCanonical: 'Mint canonical Soul',
  headerLabel: 'Animacraft handoff',
  headerTitleNamed: 'Continue {name} as one Soul',
  headerTitle: 'Continue as one Soul',
  headerSubtitle:
    'Animacraft supplies the Maker recipe and artwork. Soulidity owns the finished Soul, Living Content, social identity, and marketplace lifecycle.',
  backToAnimacraft: 'Back to Animacraft',
  maker: 'Maker',
  recipeHash: 'Recipe hash',
  protocol: 'Protocol',
  commerceV5: 'Commerce v5',
  canonicalV4: 'Canonical v4',
  characterProfile: 'Character profile',
  walrusVerified: 'Walrus verified',
  renderedImage: 'Rendered image',
  walrusReferenceReceived: 'Walrus reference received',
  missing: 'Missing',
  walletChecking: 'Checking the Soulidity wallet session...',
  walletMismatch:
    'The signed-in Soulidity wallet does not match the Animacraft wallet hint. The URL hint never grants authority; reconnect the wallet that prepared this character.',
  walletVerified: 'Wallet session verified:',
  walletConnectCopy:
    'Connect and sign with the same Sui wallet used in Animacraft. A query-string wallet address is context only, never authentication.',
  connectSuiWallet: 'Connect Sui wallet',
  canonicalMint: 'Canonical mint',
  commerceV5Description:
    'Commerce v5 exact Complete. Base, {packCount} used Pack(s), Passes, quota, and Style provenance are verified on chain before the single Soul mint. The Soul creator resale royalty is frozen at {royalty}.',
  legacyMintDescription:
    '{mode} Maker mint. Secondary Maker royalty is {royalty}. Living Content is registered on Walrus before the single Soul mint.',
  paid: 'Paid',
  free: 'Free',
  validationRequired:
    'The profile and on-chain Maker must pass validation before minting.',
  freshQuote:
    'Fresh on-chain quote: {price} · {packCount} Pack(s) verified · exact Style hash verified.',
  activationPending: 'Activation pending: {details}.',
  recoveryCopy:
    'The Soul already exists on-chain. Continue only the recoverable Soulidity index sync; no second mint will be signed.',
  openSoul: 'Open Soul',
  soulidityAccount: 'Soulidity account',
  mySouls: 'My Souls',
  socialProfile: 'Social profile',
  community: 'Community',
  market: 'Market',
} as const

type IntegrationMessageKey = keyof typeof EN_MESSAGES
type IntegrationMessages = Record<IntegrationMessageKey, string>

export const ANIMACRAFT_INTEGRATION_MESSAGES = {
  en: EN_MESSAGES,
  zh: {
    languageLabel: '语言',
    languageEnglish: 'English',
    languageChinese: '简体中文',
    languageJapanese: '日本語',
    languageKorean: '한국어',
    languageVietnamese: 'Tiếng Việt',
    notSupplied: '未提供',
    handoffIncomplete: 'Animacraft 交接信息不完整。请返回 Animacraft，重新认证 OC 文件。',
    commerceNotActivated: 'Animacraft Commerce v5 尚未启用：{details}',
    commerceBindingMissing: 'Animacraft Commerce v5 交接缺少 MakerRootV5 或 MakerTreasuryV5。',
    connectWalletForPasses: '请先连接 Animacraft 使用的钱包，再验证 Commerce v5 Pass。',
    handoffValidationFailed: 'Animacraft 交接验证失败。',
    recipeValidationFailed: '已认证的 Animacraft 配方与当前链上报价不一致。',
    insufficientUsdc: '此钱包中的 USDC 不足，无法完成本次 Complete。',
    walrusFailed: 'Walrus 无法验证或准备全部必需的 Soul 文件。',
    unexpectedError: '无法完成此次 Animacraft 交接。请查看技术详情后重试。',
    technicalDetails: '技术详情',
    statusIdle: '未开始',
    statusLoading: '检查中',
    statusReady: '就绪',
    statusError: '失败',
    mintChecking: '正在检查 Maker 与配方……',
    mintRegistering: '正在注册 Living Content……',
    mintMinting: '正在铸造规范 Soul……',
    mintSyncing: '正在同步“我的 Soul”……',
    mintResume: '继续 Soulidity 同步',
    packageUpgradeRequired: '需要升级合约包',
    signCompletePrice: '签署 Complete · {price}',
    signFreeComplete: '签署免费 Complete',
    mintForPrice: '支付 {price} 铸造',
    mintCanonical: '铸造规范 Soul',
    headerLabel: 'Animacraft 交接',
    headerTitleNamed: '将 {name} 继续创建为一个 Soul',
    headerTitle: '继续创建为一个 Soul',
    headerSubtitle: 'Animacraft 提供 Maker 配方与美术；Soulidity 管理最终 Soul、Living Content、社交身份与市场生命周期。',
    backToAnimacraft: '返回 Animacraft',
    maker: 'Maker',
    recipeHash: '配方哈希',
    protocol: '协议',
    commerceV5: 'Commerce v5',
    canonicalV4: 'Canonical v4',
    characterProfile: '角色资料',
    walrusVerified: 'Walrus 已验证',
    renderedImage: '成品图片',
    walrusReferenceReceived: '已收到 Walrus 引用',
    missing: '缺失',
    walletChecking: '正在检查 Soulidity 钱包会话……',
    walletMismatch: '当前 Soulidity 钱包与 Animacraft 钱包提示不一致。URL 中的钱包地址不代表授权；请重新连接制作该角色时使用的钱包。',
    walletVerified: '钱包会话已验证：',
    walletConnectCopy: '请连接并签署 Animacraft 中使用的同一个 Sui 钱包。URL 中的钱包地址仅用于提示，不能作为身份认证。',
    connectSuiWallet: '连接 Sui 钱包',
    canonicalMint: '规范铸造',
    commerceV5Description: 'Commerce v5 精确 Complete：单次 Soul 铸造前会在链上验证 Base、{packCount} 个已用 Pack、Pass、额度与 Style 来源。Soul 创作者二级版税固定为 {royalty}。',
    legacyMintDescription: '{mode} Maker 铸造。Maker 二级版税为 {royalty}。单次 Soul 铸造前会先在 Walrus 注册 Living Content。',
    paid: '付费',
    free: '免费',
    validationRequired: '铸造前必须通过角色资料与链上 Maker 验证。',
    freshQuote: '最新链上报价：{price} · 已验证 {packCount} 个 Pack · 已验证精确 Style 哈希。',
    activationPending: '等待启用：{details}。',
    recoveryCopy: 'Soul 已经在链上存在。这里只继续可恢复的 Soulidity 索引同步，不会再次请求铸造。',
    openSoul: '打开 Soul',
    soulidityAccount: 'Soulidity 账户',
    mySouls: '我的 Soul',
    socialProfile: '社交资料',
    community: '社区',
    market: '市场',
  },
  ja: {
    languageLabel: '言語',
    languageEnglish: 'English',
    languageChinese: '简体中文',
    languageJapanese: '日本語',
    languageKorean: '한국어',
    languageVietnamese: 'Tiếng Việt',
    notSupplied: '未指定',
    handoffIncomplete: 'Animacraft の引き継ぎ情報が不完全です。Animacraft に戻り、OC ファイルを再認証してください。',
    commerceNotActivated: 'Animacraft Commerce v5 は有効化されていません：{details}',
    commerceBindingMissing: 'Animacraft Commerce v5 の引き継ぎに MakerRootV5 または MakerTreasuryV5 がありません。',
    connectWalletForPasses: 'Commerce v5 Pass を検証する前に、Animacraft で使用したウォレットを接続してください。',
    handoffValidationFailed: 'Animacraft の引き継ぎ検証に失敗しました。',
    recipeValidationFailed: '認証済み Animacraft レシピが現在のオンチェーン見積もりと一致しません。',
    insufficientUsdc: 'このウォレットの USDC 残高では Complete を実行できません。',
    walrusFailed: 'Walrus で必要な Soul ファイルをすべて検証または準備できませんでした。',
    unexpectedError: 'Animacraft の引き継ぎを完了できませんでした。技術詳細を確認して再試行してください。',
    technicalDetails: '技術詳細',
    statusIdle: '未開始',
    statusLoading: '確認中',
    statusReady: '準備完了',
    statusError: '失敗',
    mintChecking: 'Maker とレシピを確認中…',
    mintRegistering: 'Living Content を登録中…',
    mintMinting: '正規 Soul をミント中…',
    mintSyncing: 'My Souls を同期中…',
    mintResume: 'Soulidity 同期を再開',
    packageUpgradeRequired: 'パッケージの更新が必要です',
    signCompletePrice: 'Complete に署名 · {price}',
    signFreeComplete: '無料 Complete に署名',
    mintForPrice: '{price} でミント',
    mintCanonical: '正規 Soul をミント',
    headerLabel: 'Animacraft 引き継ぎ',
    headerTitleNamed: '{name} を 1 つの Soul として続ける',
    headerTitle: '1 つの Soul として続ける',
    headerSubtitle: 'Animacraft は Maker レシピとアートを提供し、Soulidity は完成した Soul、Living Content、ソーシャル ID、市場ライフサイクルを管理します。',
    backToAnimacraft: 'Animacraft に戻る',
    maker: 'Maker',
    recipeHash: 'レシピハッシュ',
    protocol: 'プロトコル',
    commerceV5: 'Commerce v5',
    canonicalV4: 'Canonical v4',
    characterProfile: 'キャラクタープロフィール',
    walrusVerified: 'Walrus 検証済み',
    renderedImage: '完成画像',
    walrusReferenceReceived: 'Walrus 参照を受信済み',
    missing: '不足',
    walletChecking: 'Soulidity のウォレットセッションを確認中…',
    walletMismatch: 'Soulidity の接続ウォレットが Animacraft のウォレット情報と一致しません。URL のアドレスは権限を付与しません。このキャラクターを作成したウォレットを再接続してください。',
    walletVerified: 'ウォレットセッション確認済み：',
    walletConnectCopy: 'Animacraft で使用したものと同じ Sui ウォレットを接続して署名してください。URL のウォレットアドレスは参考情報であり、認証ではありません。',
    connectSuiWallet: 'Sui ウォレットを接続',
    canonicalMint: '正規ミント',
    commerceV5Description: 'Commerce v5 の正確な Complete です。1 回の Soul ミント前に、Base、使用中の {packCount} Pack、Pass、割当量、Style の由来をオンチェーンで検証します。Soul 作成者の二次ロイヤリティは {royalty} に固定されます。',
    legacyMintDescription: '{mode} Maker ミント。Maker の二次ロイヤリティは {royalty} です。1 回の Soul ミント前に Living Content を Walrus に登録します。',
    paid: '有料',
    free: '無料',
    validationRequired: 'ミント前にプロフィールとオンチェーン Maker の検証が必要です。',
    freshQuote: '最新オンチェーン見積もり：{price} · {packCount} Pack を検証済み · 正確な Style ハッシュを検証済み。',
    activationPending: '有効化待ち：{details}。',
    recoveryCopy: 'Soul はすでにオンチェーンに存在します。復旧可能な Soulidity インデックス同期だけを続行し、2 回目のミント署名は行いません。',
    openSoul: 'Soul を開く',
    soulidityAccount: 'Soulidity アカウント',
    mySouls: 'My Souls',
    socialProfile: 'ソーシャルプロフィール',
    community: 'コミュニティ',
    market: 'マーケット',
  },
  ko: {
    languageLabel: '언어',
    languageEnglish: 'English',
    languageChinese: '简体中文',
    languageJapanese: '日本語',
    languageKorean: '한국어',
    languageVietnamese: 'Tiếng Việt',
    notSupplied: '제공되지 않음',
    handoffIncomplete: 'Animacraft 인계 정보가 불완전합니다. Animacraft로 돌아가 OC 파일을 다시 인증하세요.',
    commerceNotActivated: 'Animacraft Commerce v5가 활성화되지 않았습니다: {details}',
    commerceBindingMissing: 'Animacraft Commerce v5 인계에 MakerRootV5 또는 MakerTreasuryV5가 없습니다.',
    connectWalletForPasses: 'Commerce v5 Pass를 확인하기 전에 Animacraft에서 사용한 지갑을 연결하세요.',
    handoffValidationFailed: 'Animacraft 인계 검증에 실패했습니다.',
    recipeValidationFailed: '인증된 Animacraft 레시피가 현재 온체인 견적과 일치하지 않습니다.',
    insufficientUsdc: '이 지갑의 USDC가 부족하여 Complete를 실행할 수 없습니다.',
    walrusFailed: 'Walrus에서 필요한 Soul 파일을 모두 검증하거나 준비하지 못했습니다.',
    unexpectedError: 'Animacraft 인계를 완료하지 못했습니다. 기술 세부 정보를 확인한 뒤 다시 시도하세요.',
    technicalDetails: '기술 세부 정보',
    statusIdle: '시작 전',
    statusLoading: '확인 중',
    statusReady: '준비됨',
    statusError: '실패',
    mintChecking: 'Maker와 레시피 확인 중…',
    mintRegistering: 'Living Content 등록 중…',
    mintMinting: '정식 Soul 민팅 중…',
    mintSyncing: 'My Souls 동기화 중…',
    mintResume: 'Soulidity 동기화 재개',
    packageUpgradeRequired: '패키지 업그레이드 필요',
    signCompletePrice: 'Complete 서명 · {price}',
    signFreeComplete: '무료 Complete 서명',
    mintForPrice: '{price}에 민팅',
    mintCanonical: '정식 Soul 민팅',
    headerLabel: 'Animacraft 인계',
    headerTitleNamed: '{name}을(를) 하나의 Soul로 이어서 만들기',
    headerTitle: '하나의 Soul로 이어서 만들기',
    headerSubtitle: 'Animacraft는 Maker 레시피와 아트를 제공하고, Soulidity는 완성된 Soul, Living Content, 소셜 정체성 및 마켓 수명 주기를 관리합니다.',
    backToAnimacraft: 'Animacraft로 돌아가기',
    maker: 'Maker',
    recipeHash: '레시피 해시',
    protocol: '프로토콜',
    commerceV5: 'Commerce v5',
    canonicalV4: 'Canonical v4',
    characterProfile: '캐릭터 프로필',
    walrusVerified: 'Walrus 검증 완료',
    renderedImage: '완성 이미지',
    walrusReferenceReceived: 'Walrus 참조 수신 완료',
    missing: '누락',
    walletChecking: 'Soulidity 지갑 세션 확인 중…',
    walletMismatch: 'Soulidity에 연결된 지갑이 Animacraft 지갑 정보와 일치하지 않습니다. URL의 주소는 권한을 부여하지 않습니다. 이 캐릭터를 만든 지갑을 다시 연결하세요.',
    walletVerified: '지갑 세션 확인 완료:',
    walletConnectCopy: 'Animacraft에서 사용한 것과 동일한 Sui 지갑을 연결하고 서명하세요. URL의 지갑 주소는 참고 정보일 뿐 인증 수단이 아닙니다.',
    connectSuiWallet: 'Sui 지갑 연결',
    canonicalMint: '정식 민팅',
    commerceV5Description: 'Commerce v5 정확한 Complete입니다. 한 번의 Soul 민팅 전에 Base, 사용된 {packCount}개 Pack, Pass, 할당량 및 Style 출처를 온체인에서 검증합니다. Soul 제작자 재판매 로열티는 {royalty}로 고정됩니다.',
    legacyMintDescription: '{mode} Maker 민팅. Maker 재판매 로열티는 {royalty}입니다. 한 번의 Soul 민팅 전에 Living Content를 Walrus에 등록합니다.',
    paid: '유료',
    free: '무료',
    validationRequired: '민팅 전에 프로필과 온체인 Maker 검증을 통과해야 합니다.',
    freshQuote: '최신 온체인 견적: {price} · {packCount}개 Pack 검증 완료 · 정확한 Style 해시 검증 완료.',
    activationPending: '활성화 대기: {details}.',
    recoveryCopy: 'Soul이 이미 온체인에 존재합니다. 복구 가능한 Soulidity 인덱스 동기화만 계속하며 두 번째 민팅은 서명하지 않습니다.',
    openSoul: 'Soul 열기',
    soulidityAccount: 'Soulidity 계정',
    mySouls: 'My Souls',
    socialProfile: '소셜 프로필',
    community: '커뮤니티',
    market: '마켓',
  },
  vi: {
    languageLabel: 'Ngôn ngữ',
    languageEnglish: 'English',
    languageChinese: '简体中文',
    languageJapanese: '日本語',
    languageKorean: '한국어',
    languageVietnamese: 'Tiếng Việt',
    notSupplied: 'Chưa cung cấp',
    handoffIncomplete: 'Thông tin bàn giao Animacraft chưa đầy đủ. Hãy quay lại Animacraft và chứng nhận lại các tệp OC.',
    commerceNotActivated: 'Animacraft Commerce v5 chưa được kích hoạt: {details}',
    commerceBindingMissing: 'Bàn giao Animacraft Commerce v5 thiếu MakerRootV5 hoặc MakerTreasuryV5.',
    connectWalletForPasses: 'Hãy kết nối ví đã dùng trong Animacraft trước khi xác minh Pass Commerce v5.',
    handoffValidationFailed: 'Xác minh bàn giao Animacraft thất bại.',
    recipeValidationFailed: 'Công thức Animacraft đã chứng nhận không khớp với báo giá on-chain hiện tại.',
    insufficientUsdc: 'Ví này không đủ USDC để thực hiện Complete.',
    walrusFailed: 'Walrus không thể xác minh hoặc chuẩn bị đầy đủ các tệp Soul bắt buộc.',
    unexpectedError: 'Không thể hoàn tất bàn giao Animacraft. Hãy xem chi tiết kỹ thuật rồi thử lại.',
    technicalDetails: 'Chi tiết kỹ thuật',
    statusIdle: 'Chưa bắt đầu',
    statusLoading: 'Đang kiểm tra',
    statusReady: 'Sẵn sàng',
    statusError: 'Thất bại',
    mintChecking: 'Đang kiểm tra Maker và công thức…',
    mintRegistering: 'Đang đăng ký Living Content…',
    mintMinting: 'Đang mint Soul chuẩn…',
    mintSyncing: 'Đang đồng bộ My Souls…',
    mintResume: 'Tiếp tục đồng bộ Soulidity',
    packageUpgradeRequired: 'Cần nâng cấp gói',
    signCompletePrice: 'Ký Complete · {price}',
    signFreeComplete: 'Ký Complete miễn phí',
    mintForPrice: 'Mint với giá {price}',
    mintCanonical: 'Mint Soul chuẩn',
    headerLabel: 'Bàn giao Animacraft',
    headerTitleNamed: 'Tiếp tục {name} thành một Soul',
    headerTitle: 'Tiếp tục thành một Soul',
    headerSubtitle: 'Animacraft cung cấp công thức Maker và hình ảnh; Soulidity quản lý Soul hoàn chỉnh, Living Content, danh tính xã hội và vòng đời thị trường.',
    backToAnimacraft: 'Quay lại Animacraft',
    maker: 'Maker',
    recipeHash: 'Hash công thức',
    protocol: 'Giao thức',
    commerceV5: 'Commerce v5',
    canonicalV4: 'Canonical v4',
    characterProfile: 'Hồ sơ nhân vật',
    walrusVerified: 'Walrus đã xác minh',
    renderedImage: 'Ảnh hoàn chỉnh',
    walrusReferenceReceived: 'Đã nhận tham chiếu Walrus',
    missing: 'Thiếu',
    walletChecking: 'Đang kiểm tra phiên ví Soulidity…',
    walletMismatch: 'Ví đang đăng nhập Soulidity không khớp với gợi ý ví Animacraft. Địa chỉ trong URL không cấp quyền; hãy kết nối lại ví đã dùng để tạo nhân vật này.',
    walletVerified: 'Đã xác minh phiên ví:',
    walletConnectCopy: 'Hãy kết nối và ký bằng đúng ví Sui đã dùng trong Animacraft. Địa chỉ ví trong URL chỉ là ngữ cảnh, không phải xác thực.',
    connectSuiWallet: 'Kết nối ví Sui',
    canonicalMint: 'Mint chuẩn',
    commerceV5Description: 'Complete chính xác theo Commerce v5. Trước một lần mint Soul, Base, {packCount} Pack đã dùng, Pass, hạn mức và nguồn gốc Style được xác minh on-chain. Royalty bán lại của người tạo Soul được cố định ở {royalty}.',
    legacyMintDescription: 'Mint Maker {mode}. Royalty bán lại Maker là {royalty}. Living Content được đăng ký trên Walrus trước một lần mint Soul.',
    paid: 'trả phí',
    free: 'miễn phí',
    validationRequired: 'Hồ sơ và Maker on-chain phải vượt qua xác minh trước khi mint.',
    freshQuote: 'Báo giá on-chain mới nhất: {price} · đã xác minh {packCount} Pack · đã xác minh hash Style chính xác.',
    activationPending: 'Đang chờ kích hoạt: {details}.',
    recoveryCopy: 'Soul đã tồn tại on-chain. Chỉ tiếp tục đồng bộ chỉ mục Soulidity có thể khôi phục; sẽ không ký lần mint thứ hai.',
    openSoul: 'Mở Soul',
    soulidityAccount: 'Tài khoản Soulidity',
    mySouls: 'Soul của tôi',
    socialProfile: 'Hồ sơ xã hội',
    community: 'Cộng đồng',
    market: 'Thị trường',
  },
} satisfies Record<AnimacraftIntegrationLocale, IntegrationMessages>

const ANIMACRAFT_INTEGRATION_LOCALE_KEY = 'soulidity-animacraft-locale'
const SOULIDITY_ANIMACRAFT_COMPLETION_SCHEMA =
  'soulidity.animacraft-completion.v1'

function trustedAnimacraftReturnOrigin(value: string): string {
  try {
    const requested = new URL(value)
    const configured = new URL(
      process.env.NEXT_PUBLIC_ANIMACRAFT_APP_URL
        ?? 'https://animacraft.soulidity.ai',
    )
    const localhost = process.env.NODE_ENV !== 'production'
      && ['localhost', '127.0.0.1'].includes(requested.hostname)
    if (requested.origin !== configured.origin && !localhost) return ''
    if (!['https:', ...(localhost ? ['http:'] : [])].includes(requested.protocol)) {
      return ''
    }
    return requested.origin
  } catch {
    return ''
  }
}

export function normalizeAnimacraftIntegrationLocale(
  value: string | null | undefined,
): AnimacraftIntegrationLocale | null {
  const language = String(value ?? '').trim().toLowerCase().replace('_', '-')
  if (!language) return null
  if (language === 'zh' || language.startsWith('zh-')) return 'zh'
  if (language === 'ja' || language.startsWith('ja-') || language === 'jp') return 'ja'
  if (language === 'ko' || language.startsWith('ko-') || language === 'kr') return 'ko'
  if (language === 'vi' || language.startsWith('vi-')) return 'vi'
  if (language === 'en' || language.startsWith('en-')) return 'en'
  return null
}

export function formatAnimacraftIntegrationMessage(
  locale: AnimacraftIntegrationLocale,
  key: IntegrationMessageKey,
  variables: Record<string, string | number> = {},
): string {
  const template = ANIMACRAFT_INTEGRATION_MESSAGES[locale]?.[key] ?? EN_MESSAGES[key]
  return Object.entries(variables).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    template,
  )
}

function short(value: string, notSupplied: string): string {
  if (!value) return notSupplied
  return value.length > 22 ? `${value.slice(0, 10)}...${value.slice(-8)}` : value
}

function sameAddress(left: string, right: string): boolean {
  if (!left || !right) return true
  return left.toLowerCase().replace(/^0x0*/, '0x') === right.toLowerCase().replace(/^0x0*/, '0x')
}

function browserAnimacraftIntegrationLocale(): AnimacraftIntegrationLocale {
  if (typeof window === 'undefined') return 'en'
  const requested = new URLSearchParams(window.location.search).get('lang')
  let stored: string | null = null
  try {
    stored = window.localStorage.getItem(ANIMACRAFT_INTEGRATION_LOCALE_KEY)
  } catch {
    // Language detection must still work when browser storage is unavailable.
  }
  const browserLanguages = window.navigator.languages?.length
    ? window.navigator.languages
    : [window.navigator.language]
  for (const candidate of [requested, stored, ...browserLanguages]) {
    const locale = normalizeAnimacraftIntegrationLocale(candidate)
    if (locale) return locale
  }
  return 'en'
}

function integrationErrorKey(message: string): IntegrationMessageKey {
  const normalized = message.toLowerCase()
  if (normalized.includes('handoff is incomplete')) return 'handoffIncomplete'
  if (normalized.includes('commerce v5 is not activated')) return 'commerceNotActivated'
  if (
    normalized.includes('missing makerrootv5')
    || normalized.includes('missing makertreasuryv5')
  ) return 'commerceBindingMissing'
  if (
    normalized.includes('connect the animacraft wallet')
    || normalized.includes('connect and sign in with a sui wallet')
  ) return 'connectWalletForPasses'
  if (
    normalized.includes('recipe hash')
    || normalized.includes('quote does not match')
  ) return 'recipeValidationFailed'
  if (normalized.includes('insufficient usdc')) return 'insufficientUsdc'
  if (normalized.includes('walrus')) return 'walrusFailed'
  if (normalized.includes('handoff validation failed')) return 'handoffValidationFailed'
  return 'unexpectedError'
}

export function AnimacraftIntegrationClient({ handoff }: { handoff: AnimacraftHandoff }) {
  const { user, loading } = useAuth()
  const login = useLogin()
  const suiClient = useSuiClient()
  const integrationConfig = useMemo(() => getAnimacraftIntegrationConfig(), [])
  const [locale, setLocale] = useState<AnimacraftIntegrationLocale>('en')
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [profile, setProfile] = useState<ParsedAnimacraftHandoff | null>(null)
  const [maker, setMaker] = useState<AnimacraftMakerState | null>(null)
  const [commerceV5, setCommerceV5] = useState<AnimacraftCommerceV5State | null>(null)
  const recoveryContext = useMemo(
    () => normalizeAnimacraftMintRecoveryContext({
      protocolVersion: (
        handoff.commerceRootId
        || handoff.commerceTreasuryId
        || handoff.outputSealId
        || handoff.outputNonce
        || handoff.outputDigest
      ) ? 5 : 4,
      makerId: handoff.makerId,
      makerRootId: handoff.commerceRootId,
      recipeHashHex: handoff.recipeHash,
      outputSealIdHex: handoff.outputSealId,
      outputNonceHex: handoff.outputNonce,
      outputDigestHex: handoff.outputDigest,
      returnOrigin: trustedAnimacraftReturnOrigin(handoff.returnOrigin),
      returnNonce: handoff.returnNonce,
    }),
    [
      handoff.commerceRootId,
      handoff.commerceTreasuryId,
      handoff.makerId,
      handoff.outputDigest,
      handoff.outputNonce,
      handoff.outputSealId,
      handoff.recipeHash,
      handoff.returnNonce,
      handoff.returnOrigin,
    ],
  )
  const mintFlow = useAnimacraftMint(recoveryContext)
  const connectedAddress = user?.primarySuiAddress ?? ''
  const walletMismatch = Boolean(
    connectedAddress
    && handoff.walletHint
    && !sameAddress(connectedAddress, handoff.walletHint),
  )
  const hasHandoff = Boolean(
    handoff.makerId
    && handoff.profileUrl
    && handoff.imageUrl
    && handoff.profileBlobId
    && handoff.imageBlobId
    && handoff.recipeHash,
  )
  const activeIntegrationReady = profile?.protocolVersion === 5
    ? integrationConfig.commerceV5Ready
    : integrationConfig.ready
  const activeIntegrationMissing = profile?.protocolVersion === 5
    ? integrationConfig.commerceV5Missing
    : integrationConfig.missing
  const t = (
    key: IntegrationMessageKey,
    variables: Record<string, string | number> = {},
  ) => formatAnimacraftIntegrationMessage(locale, key, variables)
  const localizedLoadError = loadError
    ? locale === 'en'
      ? loadError
      : t(integrationErrorKey(loadError), {
          details: loadError.split(':').slice(1).join(':').trim() || loadError,
        })
    : ''
  const localizedMintError = mintFlow.error
    ? locale === 'en'
      ? mintFlow.error
      : t(integrationErrorKey(mintFlow.error), {
          details: mintFlow.error.split(':').slice(1).join(':').trim() || mintFlow.error,
        })
    : ''

  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => {
      if (!cancelled) setLocale(browserAnimacraftIntegrationLocale())
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!mintFlow.result) return
    const completionContext = mintFlow.result.recoveryContext
    const targetOrigin = trustedAnimacraftReturnOrigin(
      completionContext.returnOrigin,
    )
    if (
      completionContext.protocolVersion !== 5
      || !targetOrigin
      || !completionContext.returnNonce
      || !completionContext.outputSealIdHex
      || !completionContext.outputNonceHex
      || !completionContext.outputDigestHex
      || !mintFlow.result.outputProvenanceObjectId
      || !window.opener
      || window.opener.closed
    ) return
    window.opener.postMessage({
      schemaVersion: SOULIDITY_ANIMACRAFT_COMPLETION_SCHEMA,
      returnNonce: completionContext.returnNonce,
      txDigest: mintFlow.result.txDigest,
      soulObjectId: mintFlow.result.soulOnChainId,
      provenanceObjectId: mintFlow.result.provenanceObjectId,
      outputProvenanceObjectId:
        mintFlow.result.outputProvenanceObjectId,
    }, targetOrigin)
  }, [mintFlow.result])

  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(async () => {
      if (cancelled) return
      if (!hasHandoff) {
        setLoadState('error')
        setLoadError('The Animacraft handoff is incomplete. Return to Animacraft and certify the OC files again.')
        return
      }
      setLoadState('loading')
      setLoadError(null)
      try {
        const profileUrl = assertAnimacraftWalrusPatchUrl(
          handoff.profileUrl,
          handoff.profileBlobId,
          'Animacraft profile',
        )
        const previewBlobId =
          handoff.imagePreviewBlobId || handoff.imageBlobId
        assertAnimacraftWalrusPatchUrl(
          handoff.imageUrl,
          previewBlobId,
          'Animacraft image preview',
        )
        const [nextProfile, makerResponse] = await Promise.all([
          fetchAnimacraftOcPackage(profileUrl, handoff.makerId),
          suiClient.getObject({
            id: handoff.makerId,
            options: { showContent: true, showType: true },
          }),
        ])
        if (cancelled) return
        if (
          !recoveryContext
          || recoveryContext.protocolVersion !== nextProfile.protocolVersion
        ) {
          throw new Error(
            'The Animacraft handoff does not match its exact recovery context',
          )
        }
        const nextMaker = parseAnimacraftMakerObject(makerResponse, handoff.makerId)
        let nextCommerceV5: AnimacraftCommerceV5State | null = null
        if (nextProfile.protocolVersion === 5) {
          const exact32ByteHex = /^0x[0-9a-fA-F]{64}$/
          if (
            !exact32ByteHex.test(handoff.outputSealId)
            || !exact32ByteHex.test(handoff.outputNonce)
            || !exact32ByteHex.test(handoff.outputDigest)
          ) {
            throw new Error(
              'Animacraft commerce v5 is missing the exact protected output Seal ID, nonce, or digest',
            )
          }
          if (!handoff.imagePreviewBlobId) {
            throw new Error(
              'Animacraft commerce v5 requires a public preview Blob distinct from the protected final image Blob',
            )
          }
          if (handoff.imagePreviewBlobId === handoff.imageBlobId) {
            throw new Error(
              'Animacraft commerce v5 cannot expose the protected final image as its public preview',
            )
          }
          if (!integrationConfig.commerceV5Ready) {
            throw new Error(
              `Animacraft commerce v5 is not activated: ${integrationConfig.commerceV5Missing.join(', ')}`,
            )
          }
          if (!handoff.commerceRootId || !handoff.commerceTreasuryId) {
            throw new Error(
              'The Animacraft commerce v5 handoff is missing MakerRootV5 or MakerTreasuryV5',
            )
          }
          if (!connectedAddress) {
            throw new Error('Connect the Animacraft wallet before verifying commerce v5 Passes')
          }
          const [
            rootResponse,
            makerTreasuryResponse,
            protocolResponse,
            protocolTreasuryResponse,
            passes,
          ] = await Promise.all([
            suiClient.getObject({
              id: handoff.commerceRootId,
              options: { showContent: true, showType: true },
            }),
            suiClient.getObject({
              id: handoff.commerceTreasuryId,
              options: { showContent: true, showType: true },
            }),
            suiClient.getObject({
              id: integrationConfig.commerceV5ProtocolConfigId,
              options: { showContent: true, showType: true },
            }),
            suiClient.getObject({
              id: integrationConfig.commerceV5ProtocolTreasuryId,
              options: { showContent: true, showType: true },
            }),
            fetchAnimacraftPassesV5(suiClient, {
              owner: connectedAddress,
              typeOriginPackageId: integrationConfig.commerceV5TypeOriginPackageId,
              expectedRootId: handoff.commerceRootId,
            }),
          ])
          nextCommerceV5 = {
            root: parseAnimacraftMakerRootV5Object(
              rootResponse,
              handoff.commerceRootId,
              integrationConfig.commerceV5TypeOriginPackageId,
            ),
            makerTreasury: parseAnimacraftMakerTreasuryV5Object(
              makerTreasuryResponse,
              handoff.commerceTreasuryId,
              integrationConfig.commerceV5TypeOriginPackageId,
            ),
            protocol: parseAnimacraftProtocolV5Object(
              protocolResponse,
              integrationConfig.commerceV5ProtocolConfigId,
              integrationConfig.commerceV5TypeOriginPackageId,
            ),
            protocolTreasury: parseAnimacraftProtocolTreasuryV5Object(
              protocolTreasuryResponse,
              integrationConfig.commerceV5ProtocolTreasuryId,
              integrationConfig.commerceV5TypeOriginPackageId,
            ),
            ...passes,
          }
          verifyAnimacraftCommerceV5State(nextCommerceV5, {
            expectedLegacyMakerId: handoff.makerId,
            expectedRootId: handoff.commerceRootId,
            expectedMakerTreasuryId: handoff.commerceTreasuryId,
            expectedProtocolConfigId: integrationConfig.commerceV5ProtocolConfigId,
            expectedProtocolTreasuryId: integrationConfig.commerceV5ProtocolTreasuryId,
            expectedPaymentCoinType: nextMaker.paymentCoinType,
            wallet: connectedAddress,
            usedPackIds: nextProfile.usedPackIds,
            legacyMaker: nextMaker,
            soulCreatorRoyaltyBps: nextProfile.soulCreatorRoyaltyBps,
          })
        }
        setProfile(nextProfile)
        setMaker(nextMaker)
        setCommerceV5(nextCommerceV5)
        setLoadState('ready')
      } catch (nextError) {
        if (cancelled) return
        setProfile(null)
        setMaker(null)
        setCommerceV5(null)
        setLoadState('error')
        setLoadError(nextError instanceof Error ? nextError.message : 'Animacraft handoff validation failed')
      }
    })
    return () => {
      cancelled = true
    }
  }, [
    handoff.imageBlobId,
    handoff.imagePreviewBlobId,
    handoff.imageUrl,
    handoff.commerceRootId,
    handoff.commerceTreasuryId,
    handoff.makerId,
    handoff.profileBlobId,
    handoff.profileUrl,
    hasHandoff,
    connectedAddress,
    integrationConfig,
    recoveryContext,
    suiClient,
  ])

  const mintBusy = ['preflight', 'uploading', 'signing', 'syncing'].includes(mintFlow.status)
  const makerReadyForProtocol = Boolean(
    maker
    && maker.published
    && (
      profile?.protocolVersion === 5
        ? (
            maker.archived
            && !maker.mintingEnabled
            && !maker.mintFeeEnabled
            && maker.mintPriceAtomic === 0n
          )
        : maker.mintingEnabled && !maker.archived
    ),
  )
  const canMint = mintFlow.hasRecovery
    ? Boolean(
        activeIntegrationReady
        && user
        && recoveryContext
        && !walletMismatch
        && !mintBusy,
      )
    : Boolean(
        activeIntegrationReady
        && user
        && recoveryContext
        && !walletMismatch
        && loadState === 'ready'
        && profile
        && maker
        && (profile.protocolVersion === 4 || commerceV5)
        && makerReadyForProtocol
        && !mintBusy,
      )
  const mintLabel = (() => {
    if (mintFlow.status === 'preflight') return t('mintChecking')
    if (mintFlow.status === 'uploading') return t('mintRegistering')
    if (mintFlow.status === 'signing') return t('mintMinting')
    if (mintFlow.status === 'syncing') return t('mintSyncing')
    if (mintFlow.hasRecovery) return t('mintResume')
    if (!activeIntegrationReady) return t('packageUpgradeRequired')
    if (mintFlow.completeQuoteV5) {
      const quote = mintFlow.completeQuoteV5
      return quote.totalDueAtomic > 0n
        ? t('signCompletePrice', {
            price: formatAtomicAmountForDisplay(quote.totalDueAtomic.toString()),
          })
        : t('signFreeComplete')
    }
    if (maker?.mintFeeEnabled) {
      return t('mintForPrice', {
        price: formatAtomicAmountForDisplay(maker.mintPriceAtomic.toString()),
      })
    }
    return t('mintCanonical')
  })()
  const loadStateLabel = t({
    idle: 'statusIdle',
    loading: 'statusLoading',
    ready: 'statusReady',
    error: 'statusError',
  }[loadState] as IntegrationMessageKey)
  const languageOptions: Array<[AnimacraftIntegrationLocale, IntegrationMessageKey]> = [
    ['en', 'languageEnglish'],
    ['zh', 'languageChinese'],
    ['ja', 'languageJapanese'],
    ['ko', 'languageKorean'],
    ['vi', 'languageVietnamese'],
  ]

  return (
    <div lang={locale}>
      <PageContainer size="md" className="space-y-6">
      <SectionHeader
        label={t('headerLabel')}
        title={profile?.name
          ? t('headerTitleNamed', { name: profile.name })
          : t('headerTitle')}
        subtitle={t('headerSubtitle')}
        action={(
          <div className="flex flex-wrap items-center justify-end gap-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-muted">
              <span>{t('languageLabel')}</span>
              <select
                className="rounded-lg border border-border bg-card px-2 py-2 text-sm text-foreground"
                value={locale}
                onChange={(event) => {
                  const nextLocale =
                    normalizeAnimacraftIntegrationLocale(event.currentTarget.value) ?? 'en'
                  setLocale(nextLocale)
                  try {
                    window.localStorage.setItem(
                      ANIMACRAFT_INTEGRATION_LOCALE_KEY,
                      nextLocale,
                    )
                  } catch {
                    // The URL remains the durable fallback when storage is blocked.
                  }
                  const nextUrl = new URL(window.location.href)
                  nextUrl.searchParams.set('lang', nextLocale)
                  window.history.replaceState(window.history.state, '', nextUrl)
                }}
              >
                {languageOptions.map(([value, label]) => (
                  <option key={value} value={value}>{t(label)}</option>
                ))}
              </select>
            </label>
            <a
              href={`https://animacraft.soulidity.ai/?lang=${encodeURIComponent(locale)}#make`}
              className={buttonStyles({ variant: 'outline' })}
            >
              {t('backToAnimacraft')}
            </a>
          </div>
        )}
      />

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid gap-px bg-border sm:grid-cols-2">
          {[
            [t('maker'), short(handoff.makerId, t('notSupplied'))],
            [t('recipeHash'), short(handoff.recipeHash, t('notSupplied'))],
            [
              t('protocol'),
              profile?.protocolVersion === 5 ? t('commerceV5') : t('canonicalV4'),
            ],
            [
              t('characterProfile'),
              loadState === 'ready' ? t('walrusVerified') : loadStateLabel,
            ],
            [
              t('renderedImage'),
              handoff.imageUrl ? t('walrusReferenceReceived') : t('missing'),
            ],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0 bg-card px-4 py-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">{label}</div>
              <div className="mt-1 break-all font-mono text-xs text-foreground">{value}</div>
            </div>
          ))}
        </div>
      </section>

      <section
        className={cn(
          'border-l-4 px-4 py-3 text-sm leading-relaxed',
          walletMismatch
            ? 'border-gold bg-gold/10 text-foreground'
            : user
              ? 'border-teal bg-teal/10 text-foreground'
              : 'border-purple bg-purple/10 text-muted',
        )}
      >
        {loading ? (
          t('walletChecking')
        ) : walletMismatch ? (
          t('walletMismatch')
        ) : user ? (
          <>{t('walletVerified')} <span className="font-mono text-xs text-tech-text">{short(connectedAddress, t('notSupplied'))}</span></>
        ) : (
          t('walletConnectCopy')
        )}
      </section>

      {!user && !loading && (
        <Button variant="primary" onClick={login}>{t('connectSuiWallet')}</Button>
      )}

      <section className="border-t border-border pt-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-foreground">{t('canonicalMint')}</h2>
            <p className="mt-1 max-w-[58ch] text-sm leading-relaxed text-muted">
              {maker
                ? profile?.protocolVersion === 5 && commerceV5
                  ? t('commerceV5Description', {
                      packCount: profile.usedPackIds.length,
                      royalty: `${(profile.soulCreatorRoyaltyBps / 100).toFixed(1)}%`,
                    })
                  : t('legacyMintDescription', {
                      mode: t(maker.mintFeeEnabled ? 'paid' : 'free'),
                      royalty: `${(maker.royaltyBps / 100).toFixed(1)}%`,
                    })
                : t('validationRequired')}
            </p>
            {mintFlow.completeQuoteV5 && (
              <p className="mt-2 text-xs text-tech-text">
                {t('freshQuote', {
                  price: mintFlow.completeQuoteV5.totalDueAtomic > 0n
                    ? formatAtomicAmountForDisplay(
                        mintFlow.completeQuoteV5.totalDueAtomic.toString(),
                      )
                    : t('free'),
                  packCount: mintFlow.completeQuoteV5.usedPackCount.toString(),
                })}
              </p>
            )}
            {!activeIntegrationReady && (
              <p className="mt-2 text-xs text-value-text">
                {t('activationPending', {
                  details: activeIntegrationMissing.join(', '),
                })}
              </p>
            )}
            {loadError && (
              <div className="mt-2 text-xs text-danger" role="alert">
                <p>{localizedLoadError}</p>
                {locale !== 'en' && localizedLoadError !== loadError && (
                  <details className="mt-1 text-muted">
                    <summary>{t('technicalDetails')}</summary>
                    <code className="mt-1 block break-all">{loadError}</code>
                  </details>
                )}
              </div>
            )}
            {mintFlow.error && (
              <div className="mt-2 text-xs text-danger" role="alert">
                <p>{localizedMintError}</p>
                {locale !== 'en' && localizedMintError !== mintFlow.error && (
                  <details className="mt-1 text-muted">
                    <summary>{t('technicalDetails')}</summary>
                    <code className="mt-1 block break-all">{mintFlow.error}</code>
                  </details>
                )}
              </div>
            )}
            {mintFlow.hasRecovery && mintFlow.status !== 'done' && (
              <p className="mt-2 text-xs text-tech-text">
                {t('recoveryCopy')}
              </p>
            )}
          </div>
          {mintFlow.result ? (
            <Link
              href={`/souls/${encodeURIComponent(mintFlow.result.soulOnChainId)}`}
              className={buttonStyles({ variant: 'teal' })}
            >
              {t('openSoul')}
            </Link>
          ) : (
            <Button
              variant="primary"
              disabled={!canMint}
              onClick={() => {
                if (mintFlow.hasRecovery) {
                  void mintFlow.resume()
                  return
                }
                if (!profile || !maker || !recoveryContext) return
                void mintFlow.mint({
                  config: integrationConfig,
                  handoff: profile,
                  maker,
                  commerceV5,
                  recoveryContext,
                  profileJsonBlobId: handoff.profileBlobId,
                  imageBlobId: handoff.imageBlobId,
                  imageUrl: handoff.imageUrl,
                  recipeHashHex: handoff.recipeHash,
                  outputSealIdHex: handoff.outputSealId,
                  outputNonceHex: handoff.outputNonce,
                  outputDigestHex: handoff.outputDigest,
                })
              }}
            >
              {mintLabel}
            </Button>
          )}
        </div>
      </section>

      <section className="border-t border-border pt-5">
        <h2 className="text-base font-bold text-foreground">{t('soulidityAccount')}</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Link href="/my-souls?source=animacraft" className={buttonStyles({ variant: 'outline', full: true })}>{t('mySouls')}</Link>
          <Link href="/profile?source=animacraft" className={buttonStyles({ variant: 'outline', full: true })}>{t('socialProfile')}</Link>
          <Link href="/community?source=animacraft" className={buttonStyles({ variant: 'outline', full: true })}>{t('community')}</Link>
          <Link href="/market?source=animacraft" className={buttonStyles({ variant: 'outline', full: true })}>{t('market')}</Link>
        </div>
      </section>
      </PageContainer>
    </div>
  )
}
