import { forwardRef, type ImgHTMLAttributes } from 'react'

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string | { src: string; width?: number; height?: number }
  fill?: boolean; priority?: boolean; unoptimized?: boolean; quality?: number
  placeholder?: string; blurDataURL?: string
}
/** Native original-image loading; no owned Next image optimizer endpoint. */
const Image = forwardRef<HTMLImageElement, Props>(function Image({ src, fill, priority,
  unoptimized: _unoptimized, quality: _quality, placeholder: _placeholder,
  blurDataURL: _blur, width, height, style, loading, ...props }, ref) {
  return <img {...props} ref={ref} src={typeof src === 'string' ? src : src.src}
    width={fill ? undefined : width ?? (typeof src === 'object' ? src.width : undefined)}
    height={fill ? undefined : height ?? (typeof src === 'object' ? src.height : undefined)}
    loading={priority ? 'eager' : loading ?? 'lazy'} fetchPriority={priority ? 'high' : props.fetchPriority}
    style={fill ? { position: 'absolute', width: '100%', height: '100%', inset: 0, ...style } : style} />
})
export default Image
