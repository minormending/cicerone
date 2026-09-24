import type { Coordinates } from '../domain/types.ts'

/**
 * Google's encoded polyline, decoded.
 *
 * The format is a base64-ish run of deltas: each coordinate is the difference
 * from the one before, multiplied by 1e5, zig-zagged so negatives stay small,
 * then chopped into five-bit chunks with a continuation bit and shifted into
 * printable ASCII. It exists because a route is mostly tiny steps, and the
 * deltas of a tiny step fit in one or two characters where a pair of floats
 * would take thirty.
 *
 * Twenty lines of it here rather than a dependency, because that is the whole
 * specification and it has not changed since 2005.
 *
 * Anything malformed decodes to whatever it decodes to and is then rejected
 * by the caller on shape, not by throwing here: a half-read polyline is a
 * short line on a map, and this is not the layer that should decide whether
 * that matters.
 */
export function decodePolyline(encoded: string): Coordinates[] {
  const points: Coordinates[] = []
  let index = 0
  let lat = 0
  let lon = 0

  while (index < encoded.length) {
    lat += delta()
    lon += delta()
    // Rounded back to the five places the format actually carries. Dividing
    // an integer by 1e5 in binary floating point produces 50.08751000000001,
    // and a thousand of those serialise to six times the JSON of the number
    // they are pretending to be.
    points.push({ lat: round5(lat), lon: round5(lon) })
  }
  return points

  function round5(scaled: number): number {
    return Number((scaled / 1e5).toFixed(5))
  }

  function delta(): number {
    let shift = 0
    let result = 0
    let byte: number
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20 && index < encoded.length)
    // The low bit is the sign, which is what keeps a small negative delta one
    // character wide instead of five.
    return result & 1 ? ~(result >> 1) : result >> 1
  }
}
