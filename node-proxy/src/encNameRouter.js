'use strict'

import Router from 'koa-router'
import bodyparser from 'koa-bodyparser'
import { encodeName, pathFindPasswd, convertShowName, convertRealName, convertRealPath } from './utils/commonUtil'
import path from 'path'
import { httpClient, httpProxy } from './utils/httpClient'
import FlowEnc from './utils/flowEnc'
import { logger } from './common/logger'
import { cacheFileInfo, getFileInfo } from './dao/fileDao'

async function sleep(time) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve()
    }, time || 3000)
  })
}

// bodyparser解析body
const bodyparserMw = bodyparser({ enableTypes: ['json', 'form', 'text'] })

const encNameRouter = new Router()
const origPrefix = 'orig_'

// 针对路径加密处理
const decodeFsListPath = async (ctx, next) => {
  const { name, dir, names } = ctx.request.body
  logger.info('@@foldPath', ctx.request.body.name)
  await next()
}

// 如果目录加密了，先把名字恢复到 realName
encNameRouter.all(/^\/api\/fs\/*/, bodyparserMw, decodeFsListPath)

// 缓存alist的文件信息
const cacheFileInfoList = async (ctx, next) => {
  const { path: foldPath } = ctx.request.body
  const realfoldPath = convertRealPath(ctx.req.webdavConfig.passwdList, foldPath)
  ctx.request.body.path = realfoldPath

  // 判断打开的文件是否要解密，要解密则替换url，否则透传
  ctx.req.reqBody = JSON.stringify(ctx.request.body)
  logger.info('@@fs/reqBody', ctx.req.reqBody)
  const respBody = await httpClient(ctx.req)
  // logger.info('@@@respBody', respBody)
  const result = JSON.parse(respBody)
  ctx.body = result
  if (!result.data) {
    await next()
    return
  }
  const content = result.data.content
  if (!content) {
    await next()
    return
  }
  for (let i = 0; i < content.length; i++) {
    const fileInfo = content[i]
    fileInfo.path = realfoldPath + '/' + fileInfo.name
    // 这里要注意闭包问题，mad
    logger.debug('@@cacheFileInfo', fileInfo.path)
    cacheFileInfo(fileInfo)
  }
  // waiting cacheFileInfo a moment
  if (content.length > 100) {
    await sleep(50)
  }
  logger.info('@@fs/list', content.length)
  await next()
}

const decryptFileList = async (ctx, next) => {
  console.log('@@decrypt file name ', ctx.req.url)
  const result = ctx.body
  const { passwdList } = ctx.req.webdavConfig
  if (result.code === 200 && result.data) {
    const content = result.data.content
    if (!content) {
      return
    }
    for (let i = 0; i < content.length; i++) {
      const fileInfo = content[i]
      //  Check path if the file name needs to be encrypted
      const { passwdInfo } = pathFindPasswd(passwdList, decodeURI(fileInfo.path))
      if (!passwdInfo) {
        continue
      }
      // ingore encName
      if (passwdInfo.encFolder) {
        fileInfo.name = convertShowName(passwdInfo.password, passwdInfo.encType, fileInfo.name)
      } else if (passwdInfo.encName && !fileInfo.is_dir) {
        fileInfo.name = convertShowName(passwdInfo.password, passwdInfo.encType, fileInfo.name)
      }
    }
    const coverNameMap = {} //根据不含后缀的视频文件名找到对应的含后缀的封面文件名
    const omitNames = [] //用于隐藏封面文件
    const { path } = JSON.parse(ctx.req.reqBody)
    result.data.content.forEach((fileInfo) => {
      if (fileInfo.is_dir) {
        return
      }
      if (fileInfo.type === 5) {
        coverNameMap[fileInfo.name.split('.')[0]] = fileInfo.name
      }
    })
    result.data.content.forEach((fileInfo) => {
      if (fileInfo.is_dir) {
        return
      }
      const coverName = coverNameMap[fileInfo.name.split('.')[0]]
      if (fileInfo.type === 2 && coverName) {
        omitNames.push(coverName)
        fileInfo.thumb = `/d${path}/${coverName}`
      }
    })
    //不展示封面文件，也许可以添加个配置让用户选择是否展示封面源文件
    result.data.content = result.data.content.filter((fileInfo) => !omitNames.includes(fileInfo.name))
  }
}

// 拦截/api/fs/list
encNameRouter.all('/api/fs/list', bodyparserMw, cacheFileInfoList, decryptFileList)

// 处理网页上传文件
encNameRouter.put('/api/fs/put', async (ctx, next) => {
  const request = ctx.req
  const { headers, webdavConfig } = request
  const contentLength = headers['content-length'] || 0
  request.fileSize = contentLength * 1

  let uploadPath = headers['file-path'] ? decodeURIComponent(headers['file-path']) : '/-'
  const { passwdInfo, pathInfo } = pathFindPasswd(webdavConfig.passwdList, uploadPath)
  if (passwdInfo) {
    const fileName = path.basename(uploadPath)
    // 尝试解密路径，去掉第一个目录
    const foldNames = pathInfo[0].split('/')
    foldNames.shift()
    for (let name of foldNames) {
      const realame = convertRealName(passwdInfo.password, passwdInfo.encType, name)
      uploadPath = uploadPath.replace(name, realame)
    }
    // you can custom Suffix
    if (passwdInfo.encName) {
      const ext = passwdInfo.encSuffix || path.extname(fileName)
      const encName = encodeName(passwdInfo.password, passwdInfo.encType, fileName)
      const filePath = path.dirname(uploadPath) + '/' + encName + ext
      console.log('@@@encfileName', fileName, uploadPath, filePath)
      headers['file-path'] = encodeURIComponent(filePath)
    }
    const flowEnc = new FlowEnc(passwdInfo.password, passwdInfo.encType, request.fileSize)
    return await httpProxy(ctx.req, ctx.res, flowEnc.encryptTransform())
  }
  return await httpProxy(ctx.req, ctx.res)
})

// remove
encNameRouter.all('/api/fs/remove', bodyparserMw, async (ctx, next) => {
  const { dir: folderPath, names } = ctx.request.body
  const dir = convertRealPath(ctx.req.webdavConfig.passwdList, folderPath)
  const { webdavConfig } = ctx.req
  const { passwdInfo } = pathFindPasswd(webdavConfig.passwdList, dir)
  // maybe a folder，remove anyway the name
  const fileNames = Object.assign([], names)
  if (passwdInfo && passwdInfo.encName) {
    for (let i = 0; i < names.length; i++) {
      fileNames[i] = convertRealName(passwdInfo.password, passwdInfo.encType, names[i])
    }
  }
  const reqBody = { dir, names: fileNames }
  logger.info('@@reqBody remove', reqBody)
  ctx.req.reqBody = JSON.stringify(reqBody)
  // reset content-length length
  delete ctx.req.headers['content-length']
  const respBody = await httpClient(ctx.req)
  ctx.body = respBody
})

const copyOrMoveFile = async (ctx, next) => {
  const { dst_dir: dstDir, src_dir: srcDir, names } = ctx.request.body
  const { webdavConfig } = ctx.req
  const { passwdInfo } = pathFindPasswd(webdavConfig.passwdList, srcDir)
  let fileNames = []
  if (passwdInfo && passwdInfo.encName) {
    logger.info('@@move encName', passwdInfo.encName)
    for (const name of names) {
      // is not enc name
      if (name.indexOf(origPrefix) === 0) {
        const origName = name.replace(origPrefix, '')
        fileNames.push(origName)
        break
      }
      const fileName = path.basename(name)
      // you can custom Suffix
      const ext = passwdInfo.encSuffix || path.extname(fileName)
      const encName = encodeName(passwdInfo.password, passwdInfo.encType, fileName)
      const newFileName = encName + ext
      fileNames.push(newFileName)
    }
  } else {
    fileNames = Object.assign([], names)
  }
  const reqBody = { dst_dir: dstDir, src_dir: srcDir, names: fileNames }
  ctx.req.reqBody = JSON.stringify(reqBody)
  logger.info('@@move reqBody', ctx.req.reqBody)
  // reset content-length length
  delete ctx.req.headers['content-length']
  const respBody = await httpClient(ctx.req)
  ctx.body = respBody
}

encNameRouter.all('/api/fs/move', bodyparserMw, copyOrMoveFile)
encNameRouter.all('/api/fs/copy', bodyparserMw, copyOrMoveFile)

encNameRouter.all('/api/fs/get', bodyparserMw, async (ctx, next) => {
  let { path: filePath } = ctx.request.body
  const { webdavConfig } = ctx.req
  const foldRealPath = convertRealPath(ctx.req.webdavConfig.passwdList, path.dirname(filePath))

  const { passwdInfo } = pathFindPasswd(webdavConfig.passwdList, filePath)
  if (passwdInfo && passwdInfo.encName) {
    // reset content-length length
    delete ctx.req.headers['content-length']
    // check fileName is not enc
    const fileName = path.basename(filePath)
    const fileInfo = await getFileInfo(encodeURIComponent(filePath))
    if (fileInfo && fileInfo.is_dir) {
      await next()
      return
    }
    //  Check if it is a directory
    const realName = convertRealName(passwdInfo.password, passwdInfo.encType, fileName)
    const fpath = foldRealPath + '/' + realName
    console.log('@@@getFilePath', fpath)
    ctx.request.body.path = fpath
  }
  await next()
  if (passwdInfo && passwdInfo.encName) {
    // return showName
    const showName = convertShowName(passwdInfo.password, passwdInfo.encType, ctx.body.data.name)
    ctx.body.data.name = showName
  }
})

encNameRouter.all('/api/fs/rename', bodyparserMw, async (ctx, next) => {
  let { path: filePath, name } = ctx.request.body
  console.log('@@@filePath', filePath)
  const { webdavConfig } = ctx.req
  const { passwdInfo } = pathFindPasswd(webdavConfig.passwdList, filePath)
  const folderPath = convertRealPath(ctx.req.webdavConfig.passwdList, path.dirname(filePath))
  filePath = folderPath + '/' + path.basename(filePath)

  const reqBody = { path: filePath, name }
  console.log('@@222reqBody', reqBody)
  ctx.req.reqBody = reqBody
  // reset content-length length
  delete ctx.req.headers['content-length']

  let fileInfo = await getFileInfo(encodeURIComponent(filePath))
  if (fileInfo == null && passwdInfo && passwdInfo.encName) {
    // mabay a file
    const realName = convertRealName(passwdInfo.password, passwdInfo.encType, filePath)
    const realFilePath = path.dirname(filePath) + '/' + realName
    fileInfo = await getFileInfo(encodeURIComponent(realFilePath))
  }
  if (passwdInfo && passwdInfo.encName && fileInfo && !fileInfo.is_dir) {
    // reset content-length length
    // you can custom Suffix
    const ext = passwdInfo.encSuffix || path.extname(name)
    const realName = convertRealName(passwdInfo.password, passwdInfo.encType, filePath)
    const fpath = path.dirname(filePath) + '/' + realName
    const newName = encodeName(passwdInfo.password, passwdInfo.encType, name)
    reqBody.path = fpath
    reqBody.name = newName + ext
  }
  ctx.req.reqBody = reqBody
  console.log('@@@rename', reqBody, fileInfo.is_dir)
  const respBody = await httpClient(ctx.req)
  ctx.body = respBody
})
// 替换字符，http://alist.com/p/encname.txt?sign=12.. 替换 http://alist.com/p/realname.txt?sign=12..
const regexPath = /\/([^\\/]*?)(\?|$)/
const handleDownload = async (ctx, next) => {
  const request = ctx.req
  const { webdavConfig } = ctx.req
  let filePath = ctx.req.url.split('?')[0]
  // 如果是alist的话，那么必然有这个文件的size缓存（进过list就会被缓存起来）
  request.fileSize = 0
  // 这里需要处理掉/p 路径
  if (filePath.indexOf('/d/') === 0) {
    filePath = filePath.replace('/d/', '/')
  }
  // 这个不需要处理
  if (filePath.indexOf('/p/') === 0) {
    filePath = filePath.replace('/p/', '/')
  }
  const { passwdInfo, pathInfo } = pathFindPasswd(webdavConfig.passwdList, filePath)
  if (passwdInfo && passwdInfo.encName) {
    // 尝试解密路径，去掉第一个目录
    const foldNames = pathInfo[0].split('/')
    foldNames.shift()
    let encFoldPath = ''
    let realFoldPath = ''
    for (let name of foldNames) {
      const realFoldName = convertRealName(passwdInfo.password, passwdInfo.encType, name)
      encFoldPath += '/' + name
      realFoldPath += '/' + realFoldName
    }
    ctx.req.url = ctx.req.url.replace(encFoldPath, realFoldPath)
    ctx.req.urlAddr = ctx.req.urlAddr.replace(encFoldPath, realFoldPath)
    // reset content-length length
    delete ctx.req.headers['content-length']
    // Check whether the file name refers to an encrypted file or a directory
    const fileName = path.basename(filePath)
    const realName = convertRealName(passwdInfo.password, passwdInfo.encType, fileName)
    // Replace the real-name before downloading
    ctx.req.url = ctx.req.url.replace(regexPath, `/${realName}$2`)
    ctx.req.urlAddr = ctx.req.urlAddr.replace(regexPath, `/${realName}$2`)
    logger.debug('@@download-fileName', ctx.req.url, fileName, realName)
    await next()
    return
  }
  await next()
}

encNameRouter.get(/^\/d\/*/, bodyparserMw, handleDownload)
encNameRouter.get(/\/p\/*/, bodyparserMw, handleDownload)

// restRouter.all(/\/enc-api\/*/, router.routes(), restRouter.allowedMethods())
export default encNameRouter
