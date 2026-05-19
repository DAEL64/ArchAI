import * as THREE from 'three'
import { useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Text } from '@react-three/drei'

function Room({ position, size, name }: {
  position: [number, number, number]
  size: [number, number, number]
  name: string
}) {
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(...size)), [size])

  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={size} />
        <meshStandardMaterial color="#a8c5da" transparent opacity={0.7} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color="#2d5f7a" />
      </lineSegments>
      <Text
        position={[0, size[1] / 2 + 0.3, 0]}
        fontSize={0.3}
        color="#1a1a1a"
      >
        {name}
      </Text>
    </group>
  )
}