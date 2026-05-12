import { useState } from 'react'

import { Badge } from './ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'

function Versions(): React.JSX.Element {
  const [versions] = useState(window.electron.process.versions)

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Runtime</CardTitle>
        <CardDescription>Current desktop shell versions</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Badge variant="secondary">Electron v{versions.electron}</Badge>
        <Badge variant="secondary">Chromium v{versions.chrome}</Badge>
        <Badge variant="secondary">Node v{versions.node}</Badge>
      </CardContent>
    </Card>
  )
}

export default Versions
