/**
 * XChaCha20 流密码实现（doubao）
 * 标准：IETF XChaCha20 (RFC 8439 + draft-irtf-cfrg-xchacha)
 */
class XChaCha20 {
  constructor(password, sizeSalt, counter) {
    // 用于测试验证，chacha算法
    if (typeof counter === 'number') {
      return this._constructor(password, sizeSalt, counter)
    }
    this.password = password
    this.sizeSalt = sizeSalt + ''
    // share you folder passwdOutward safety
    this.passwdOutward = password
    if (password.length !== 32) {
      // add 'RC4' as salt
      this.passwdOutward = crypto.pbkdf2Sync(this.password, 'CHA20', 1000, 16, 'sha256').toString('hex')
    }
    // add salt
    const passwdSalt = this.passwdOutward + sizeSalt
    // fileHexKey: file passwd，could be share
    const passwdKey = crypto.createHash('sha256').update(passwdSalt).digest()
    const nonce = crypto.createHash('sha256').update(sizeSalt).digest().subarray(0, 24)
    this._constructor(passwdKey, nonce)
  }

  _constructor(key, nonce, counter = 0) {
    if (key.length !== 32) throw new Error('密钥必须是 32 字节')
    if (nonce.length !== 24) throw new Error('Nonce 必须是 24 字节')

    const subKey = this._hchacha20(key, nonce.subarray(0, 16))
    const chachaNonce = new Uint8Array(12)
    chachaNonce.set(nonce.subarray(16, 24), 4)

    this._state = new Uint32Array(16)
    this._state.set([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574])
    this._state.set(this._bytesToUint32(subKey), 4)
    this._state.set(this._bytesToUint32(chachaNonce), 12)
    // this._state = counter
    this._buffer = new Uint8Array(64)
    this._bufPos = 64
  }

  update(input) {
    const output = new Uint8Array(input.length)
    for (let i = 0; i < input.length; i++) {
      if (this._bufPos >= 64) {
        this._block()
        this._bufPos = 0
      }
      output[i] = input[i] ^ this._buffer[this._bufPos++]
    }
    return output
  }

  _hchacha20(key, nonce) {
    const st = new Uint32Array(16)
    st.set([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574])
    st.set(this._bytesToUint32(key), 4)
    st.set(this._bytesToUint32(nonce), 12)
    this._doubleRound(st, 10)
    const out = new Uint8Array(32)
    // 提取特定的8个字（通常是状态矩阵的第0-3位和第12-15位）作为输出的32字节子密钥
    const sub = new Uint32Array(16)
    sub.set(st.subarray(0, 4))
    sub.set(st.subarray(12, 16), 4)
    this._uint32ToBytes(sub, out)
    return out
  }

  _block() {
    const st = new Uint32Array(this._state)
    this._doubleRound(st, 10)
    for (let i = 0; i < 16; i++) st[i] = (st[i] + this._state[i]) >>> 0
    this._uint32ToBytes(st, this._buffer)
    // 不能this._state[12]++ >>> 0, error
    this._state[12] = (this._state[12] + 1) >>> 0
  }

  _doubleRound(st, rounds) {
    for (let i = 0; i < rounds; i++) {
      this._qr(st, 0, 4, 8, 12)
      this._qr(st, 1, 5, 9, 13)
      this._qr(st, 2, 6, 10, 14)
      this._qr(st, 3, 7, 11, 15)
      this._qr(st, 0, 5, 10, 15)
      this._qr(st, 1, 6, 11, 12)
      this._qr(st, 2, 7, 8, 13)
      this._qr(st, 3, 4, 9, 14)
    }
  }

  _qr(st, a, b, c, d) {
    st[a] = (st[a] + st[b]) >>> 0; st[d] = this._rotl(st[d] ^ st[a], 16)
    st[c] = (st[c] + st[d]) >>> 0; st[b] = this._rotl(st[b] ^ st[c], 12)
    st[a] = (st[a] + st[b]) >>> 0; st[d] = this._rotl(st[d] ^ st[a], 8)
    st[c] = (st[c] + st[d]) >>> 0; st[b] = this._rotl(st[b] ^ st[c], 7)
  }

  _rotl(v, n) {
    return (v << n) | (v >>> (32 - n))
  }

  // 8位转32位
  _bytesToUint32(b) {
    const arr = new Uint32Array(b.length / 4)
    for (let i = 0; i < arr.length; i++) arr[i] = this._readU32LE(b, i * 4)
    return arr
  }

  _readU32LE(buf, pos) {
    return buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16) | (buf[pos + 3] << 24)
  }

  // 32位转8位
  _uint32ToBytes(u, b) {
    for (let i = 0; i < u.length; i++) this._writeU32LE(b, i * 4, u[i])
    return b
  }

  _writeU32LE(buf, pos, val) {
    buf[pos] = val & 0xff
    buf[pos + 1] = (val >>> 8) & 0xff
    buf[pos + 2] = (val >>> 16) & 0xff
    buf[pos + 3] = (val >>> 24) & 0xff
  }

  // 从任意字节位置开始解密（断点续传/大文件分片）
  setPosition(offset) {
    const counter = Math.floor(offset / 64)
    this._state[12] = counter
    this._block()
    this._bufPos = offset % 64
  }
}

// 1. 生成随机 key(32B) + nonce(12B)
// const key = new Uint8Array(32).fill(1) // 演示用密钥
// const nonce = new Uint8Array(24).fill(2) // 演示用Nonce
// // 2. 明文
// const plaintext = new TextEncoder().encode('Hello, XChaCha20!')
// // 3. 加密
// const cipher = new XChaCha20(key, nonce)
// const encrypted = cipher.update(plaintext)
// console.log('密文段：', Buffer.from(encrypted).toString('hex'))
// // 4. 解密（同一个算法，重新实例化即可解密）
// const decipher = new XChaCha20(key, nonce)
// const decrypted = decipher.update(encrypted)
// console.log('明文段:', new TextDecoder().decode(decrypted))
