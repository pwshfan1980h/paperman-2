import * as THREE from 'three';

const TILE = 96; // voxels per texture repeat
const SIZE = 960;

/**
 * Placeholder asphalt so motion reads in the lab. One texel per voxel,
 * scrolled by UV offset because the rider stays at the origin.
 */
export function makeRoad() {
  const c = document.createElement('canvas');
  c.width = c.height = TILE;
  const g = c.getContext('2d')!;
  const img = g.createImageData(TILE, TILE);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const i = (y * TILE + x) * 4;
      let v = 78 + rnd() * 14;
      if (rnd() < 0.04) v += 22;
      let r = v, gg = v, b = v + 6;
      // dashed centre line along the direction of travel
      if (x >= 46 && x <= 48 && y % 48 < 24) { r = 232; gg = 192; b = 64; }
      // patch seam
      if (x === 12 || y === 70) { r *= 0.86; gg *= 0.86; b *= 0.86; }
      img.data.set([r, gg, b, 255], i);
    }
  g.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(SIZE / TILE, SIZE / TILE);
  tex.anisotropy = 8;

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), new THREE.MeshLambertMaterial({ map: tex }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;

  return {
    mesh,
    /** Keep the plane under `p`, sliding the texture so the asphalt stays put. */
    follow(p: THREE.Vector3) {
      const x = Math.round(p.x / TILE) * TILE, z = Math.round(p.z / TILE) * TILE;
      mesh.position.set(x, 0, z);
      tex.offset.set(x / TILE, -z / TILE);
    },
  };
}
