/**
 * 건물 이름으로 쓸 짧은 주소.
 *   '경기 용인시 처인구 유림로147번길 55-2 엠제이오사옥' → '유림로147번길 55-2'
 *
 * 왜: 식당을 승인할 때 건물 이름이 필요한데, 기존 건물 이름이 전부 이 모양이다
 * (신갈로 25 · 구갈로60번길 11-1 · 죽전로 150-1). 가게 이름은 **세대**로 들어간다 —
 * 한 건물에 가게가 둘 이상인 곳이 이미 있어서, 가게 이름을 건물 이름으로 쓰면
 * 두 번째 가게를 넣을 수 없다.
 */
export function shortAddress(address: string): string {
  const t = (address ?? '').trim()
  // 시·군·구를 떼고 도로명부터 남긴다
  const m = t.match(/([가-힣A-Za-z0-9]+(?:로|길)[0-9]*(?:번길)?\s*[0-9-]+)/)
  return m ? m[1].trim() : t
}

/** DB의 private.restaurant_address_key와 같은 도로명·건물번호 비교 키. */
export function buildingAddressKey(address: string): string {
  const trimmed = (address ?? '').trim()
  const match = trimmed.match(/([가-힣A-Za-z0-9]+(?:로|길)[0-9]*(?:번길)?\s*[0-9]+(?:-[0-9]+)?)/)
  return (match?.[1] ?? trimmed).toLowerCase().replace(/\s+/g, '')
}
