/*
 * @adonisjs/assembler
 *
 * (c) Harminder Virk <virk@adonisjs.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
*/

import chokidar from 'chokidar'
import { join, extname } from 'path'
import { pathExists } from 'fs-extra'
import { Logger } from '@poppinss/fancy-logs'

import { RcFile } from '../RcFile'
import { HttpServer } from '../HttpServer'
import { SERVER_ENTRY_FILE } from '../../config/paths'

/**
 * Exposes the API to watch the output build folder and restart
 * HTTP server on changes.
 */
export class BuildWatcher {
  constructor (
    private _buildRoot: string,
    private _nodeArgs: string[],
    private _logger = new Logger(),
  ) {}

  /**
   * Returns true when filePath is .js or .json. We need this to
   * restart the HTTP server
   */
  private _isScriptFile (filePath: string) {
    return ['.js', '.json'].includes(extname(filePath))
  }

  /**
   * Watch for compiled output changes
   */
  public async watch (buildDir: string) {
    const absPath = join(this._buildRoot, buildDir)
    const hasBuildDir = await pathExists(absPath)
    if (!hasBuildDir) {
      this._logger.error(`"${buildDir}" doesn't exists. Make sure to compile the source code first.`)
      return
    }

    const rcFile = new RcFile(absPath)
    const httpServer = new HttpServer(SERVER_ENTRY_FILE, absPath, this._nodeArgs, this._logger)

    /**
     * Initate watcher. Instead of ignoring files upfront, we use the
     * events handler to filter out files.
     */
    const watcher = chokidar.watch(['.'], {
      ignoreInitial: true,
      cwd: absPath,
      ignored: [
        'node_modules/**',
      ],
    })

    /**
     * Close watcher when server dies
     */
    httpServer.on('exit', ({ code }) => {
      this._logger.stop(`closing watcher. Underlying HTTP server died with "%s code"`, code)
      watcher.close()
    })

    /**
     * Handle new file additions
     */
    watcher.on('add', (filePath: string) => {
      const metaData = rcFile.getMetaData(filePath)
      if (this._isScriptFile(filePath) || metaData.reload) {
        this._logger.create(filePath)
        httpServer.restart()
      }
    })

    /**
     * Handle file updates
     */
    watcher.on('change', (filePath: string) => {
      const metaData = rcFile.getMetaData(filePath)
      if (this._isScriptFile(filePath) || metaData.reload) {
        this._logger.update(filePath)
        httpServer.restart()
      }
    })

    /**
     * Handle file removals
     */
    watcher.on('unlink', (filePath: string) => {
      const metaData = rcFile.getMetaData(filePath)
      if (metaData.rcFile) {
        this._logger.stop('cannot continue after deletion of .adonisrc.json file')
        watcher.close()
        return
      }

      if (this._isScriptFile(filePath) || metaData.reload) {
        this._logger.delete(filePath)
        httpServer.restart()
      }
    })

    /**
     * Start the http server when watcher is ready
     */
    watcher.on('ready', () => {
      this._logger.watch({ message: 'watching for file changes', suffix: buildDir })
      httpServer.start()
    })
  }
}
