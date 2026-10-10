/** Preserve omitted optional trailing arguments across the inert Next boundary.
 * JSON arrays turn undefined into null, which changes strict server contracts. */
export function ownerBoundaryArguments(args){
 if(!Array.isArray(args)||args.length===0)throw Error('inert_owner_arguments_invalid');
 const forwarded=args.slice(1);while(forwarded.length&&forwarded.at(-1)===undefined)forwarded.pop();
 if(forwarded.some(value=>value===undefined))throw Error('inert_owner_arguments_ambiguous');
 return forwarded;
}
