import Link from 'next/link'

export function PublicNav() {
  return (
    <nav className="border-b bg-white">
      <div className="max-w-4xl mx-auto px-6 flex items-center h-14 gap-6">
        <Link href="/" className="font-bold text-lg">CryptoOpenClaw</Link>
        <div className="flex gap-4">
          <Link href="/companies" className="text-sm text-gray-500 hover:text-gray-700">Companies</Link>
          <Link href="/pipeline" className="text-sm text-gray-500 hover:text-gray-700">Pipeline</Link>
        </div>
        <Link href="/login" className="ml-auto text-sm text-gray-500 hover:text-gray-700">Login</Link>
      </div>
    </nav>
  )
}
