import importlib.util
import pathlib
import struct
import unittest

path=pathlib.Path(__file__).resolve().parents[1]/'tools/sprint4-preflight.py'
spec=importlib.util.spec_from_file_location('preflight',path)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
def entry(offset,size,label=b'app'):
 return struct.pack('<HBBII16sI',0x50AA,0,0,offset,size,label,0)
class Preflight(unittest.TestCase):
 def test_bounds(self):
  self.assertEqual(module.partitions(entry(0x10000,0x140000))[0]['offset'],0x10000)
 def test_overlap(self):
  with self.assertRaises(ValueError): module.partitions(entry(0x10000,0x140000)+entry(0x20000,0x1000))
 def test_capacity(self):
  with self.assertRaises(ValueError): module.partitions(entry(0x10000,0x1000000))
 def test_empty(self):
  with self.assertRaises(ValueError): module.partitions(bytes(32))
if __name__=='__main__':unittest.main()
