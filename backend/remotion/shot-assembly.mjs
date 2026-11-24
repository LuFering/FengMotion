export function shotAssembly(timeline) {
  const sourceIds = [...new Set(timeline.shots.map(shot => shot.sourceId))]
  const imports = sourceIds.map((sourceId, index) => {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(sourceId)) throw new Error('Invalid shot source ID')
    return `import { Shot as Shot${index} } from ${JSON.stringify(`./src/shots/${sourceId}.tsx`)};`
  }).join('\n')
  const sequences = timeline.shots.map(shot => {
    const component = `Shot${sourceIds.indexOf(shot.sourceId)}`
    return `<Sequence key={${JSON.stringify(shot.id)}} name={${JSON.stringify(shot.label)}} from={${JSON.stringify(shot.startFrame)}} durationInFrames={${JSON.stringify(shot.frames)}}><${component} /></Sequence>`
  }).join('\n')
  const voice = timeline.voiceover ? `<Html5Audio src={staticFile(${JSON.stringify(timeline.voiceover)})} />` : ''
  return `import React from 'react';
import {AbsoluteFill, Composition, Html5Audio, Sequence, registerRoot, staticFile} from 'remotion';
${imports}
const Film = () => <AbsoluteFill>${sequences}${voice}</AbsoluteFill>;
registerRoot(() => <Composition id="FengMotionShots" component={Film} width={${JSON.stringify(timeline.width)}} height={${JSON.stringify(timeline.height)}} fps={${JSON.stringify(timeline.fps)}} durationInFrames={${JSON.stringify(timeline.durationInFrames)}} />);
`
}

export function shotTracks(timeline) {
  return {
    schemaVersion: 2,
    fps: timeline.fps,
    durationSeconds: timeline.durationInFrames / timeline.fps,
    origin: 'shot-assembly',
    detail: 'sequences',
    tracks: [{
      id: 'shots', name: '镜头', clips: timeline.shots.map(shot => ({
        id: shot.id, name: shot.label, kind: 'video',
        start: shot.startFrame / timeline.fps, duration: shot.frames / timeline.fps,
      })),
    }, ...(timeline.voiceover ? [{
      id: 'voiceover', name: '独立配音', clips: [{
        id: 'voiceover', name: timeline.voiceover, kind: 'audio', start: 0,
        duration: timeline.durationInFrames / timeline.fps,
      }],
    }] : [])],
  }
}
