import * as path from 'path'
import * as fs from 'fs'
import { nvim, ExtensionContext } from 'coc.nvim'

/**
 * Makes `:help coc-sonarlint` work. coc does not put an extension on the runtimepath, and putting the extension
 * folder there would make coc load the extension again, so the help page is copied to a folder of its own in the
 * storage of the extension, tagged there and that folder is added to the runtimepath.
 */
export async function registerHelp(context: ExtensionContext): Promise<void> {
    const root = path.join(context.storagePath, 'runtime')
    const doc = path.join(root, 'doc')
    await fs.promises.mkdir(doc, { recursive: true })
    await fs.promises.copyFile(path.join(context.extensionPath, 'doc', 'coc-sonarlint.txt'), path.join(doc, 'coc-sonarlint.txt'))
    await nvim.command(`silent! helptags ${await nvim.call('fnameescape', [doc])}`)
    // a single :set appends atomically; reading then writing the option would race with other extensions
    const escaped = root.replace(/([ ,\\])/g, '\\$1')
    await nvim.command(`set runtimepath-=${escaped} runtimepath+=${escaped}`)
}
