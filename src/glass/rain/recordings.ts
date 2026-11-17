export const recordings = {
  tin: { label: 'Rain on a tin roof', title: 'Rain_On_a_Tin_Roof_LOOP.wav', artist: 'digifishmusic',
    url: '/audio/rain-tin-roof.mp3', source: 'https://freesound.org/people/digifishmusic/sounds/66472/',
    license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', edit: '80 ms loop crossfade' },
  glass: { label: 'Rain on glass · touch', title: 'Rain on glass', artist: 'willpio',
    url: '/audio/rain-on-glass.mp3', source: 'https://freesound.org/people/willpio/sounds/317677/',
    license: 'CC BY-NC 3.0', licenseUrl: 'https://creativecommons.org/licenses/by-nc/3.0/', edit: '1.2 s loop crossfade' },
} as const
export type RainRecording = keyof typeof recordings
