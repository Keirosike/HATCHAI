#pragma once
#include <stddef.h>
namespace HatchIdentity {
// Bounded ASCII identifier, compatible with the existing 64-byte session limit.
#if __cplusplus >= 201402L
constexpr
#else
inline
#endif
bool email(const char* value,size_t n){
 if(!value||n<5||n>64)return false;
 size_t at=n;bool dot=false;
 for(size_t i=0;i<n;++i){unsigned char c=value[i];if(c<=32||c>=127||c=='<'||c=='>'||c=='"')return false;
 if(c=='@'){if(at!=n||i==0||i+1==n)return false;at=i;}
 else if(c=='.'&&at<n&&i>at+1&&i+1<n)dot=true;}
 return at<n&&dot&&value[n-1]!='.';
}
}
