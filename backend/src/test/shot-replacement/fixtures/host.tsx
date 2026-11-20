import React from 'react'
import { Composition, registerRoot } from 'remotion'
import { Shot } from './Shot'
import canvas from './canvas.json'

registerRoot(() => <Composition id="PilotShot" component={Shot} {...canvas} />)
