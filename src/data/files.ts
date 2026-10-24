export function joinPath(parent: string, name: string) {
  return parent === '/' ? `/${name}` : `${parent}/${name}`
}

export function parentOf(path: string) {
  const index = path.lastIndexOf('/')
  return index <= 0 ? '/' : path.slice(0, index)
}
