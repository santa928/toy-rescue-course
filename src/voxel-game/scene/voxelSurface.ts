import type { MeshLambertMaterial } from 'three';
import { VOXEL_EDGE, VOXEL_SIZE } from '../../voxelGrid';

/**
 * Shade the exposed faces of joined blocks at the vehicle's cell pitch. A wall
 * still needs just one box. Coordinates are local so the seams follow moving
 * blocks and the tilted seesaw, and thin painted markings stay flat.
 */
export const applyVoxelSurface: MeshLambertMaterial['onBeforeCompile'] = (shader) => {
  shader.vertexShader = `varying vec2 vCell;
    varying float vRelief;
    ${shader.vertexShader}`.replace('#include <begin_vertex>', `
    #include <begin_vertex>
    vec3 localPoint = position;
    vRelief = 1.0;
    #ifdef USE_INSTANCING
      vec3 extent = vec3(length(instanceMatrix[0].xyz),
                         length(instanceMatrix[1].xyz),
                         length(instanceMatrix[2].xyz));
      // Anchor the first full cell at the edge of the authored box.
      localPoint = (position + 0.5) * extent;
      vRelief = smoothstep(0.08, ${VOXEL_SIZE}, min(min(extent.x, extent.y), extent.z));
    #endif
    vec2 facePoint = abs(normal.x) > 0.5 ? localPoint.zy :
                     abs(normal.y) > 0.5 ? localPoint.xz : localPoint.xy;
    vCell = facePoint / ${VOXEL_SIZE};
  `);
  shader.fragmentShader = `varying vec2 vCell;
    varying float vRelief;
    ${shader.fragmentShader}`.replace('#include <color_fragment>', `
    #include <color_fragment>
    vec2 pixel = max(fwidth(vCell), vec2(0.001));
    vec2 edge = abs(fract(vCell + 0.5) - 0.5);
    const float seam = ${((1 - VOXEL_EDGE / VOXEL_SIZE) / 2).toFixed(4)};
    vec2 line = 1.0 - smoothstep(vec2(seam) - 0.5 * pixel, vec2(seam) + 0.5 * pixel, edge);
    // Fade fine relief before the grid becomes smaller than a screen pixel.
    float detail = vRelief * (1.0 - smoothstep(0.25, 0.85, max(pixel.x, pixel.y)));
    float tint = fract(dot(floor(vCell), vec2(0.38197, 0.61803)) + 0.27) - 0.5;
    diffuseColor.rgb *= 1.0 + detail * (0.09 * tint - 0.32 * max(line.x, line.y));
  `);
};
